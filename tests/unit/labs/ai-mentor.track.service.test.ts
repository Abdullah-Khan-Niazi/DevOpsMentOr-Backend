import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../src/shared/errors';
import { AiMentorService, type AiMentorServiceDeps } from '../../../src/features/labs/services/AiMentorService';
import { TrackService, type TrackServiceDeps } from '../../../src/features/labs/services/TrackService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

vi.mock('../../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

vi.mock('../../../src/app/cache/redis', () => {
  const make = () => {
    const store = new Map<string, string>();
    return {
      store,
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => 3600),
    };
  };
  const instance = make();
  return {
    redisClient: instance,
    cacheKeys: {
      aiMentorSession: (userId: number, lessonId: number): string => `ai_mentor:${userId}:${lessonId}`,
      aiMentorRate: (userId: number): string => `ai_mentor_rate:${userId}`,
      labExtendCount: (instanceId: number): string => `lab_extend:${instanceId}`,
    },
  };
});

import { redisClient } from '../../../src/app/cache/redis';

const mentorSpec = {
  version: 2,
  mode: 'guided',
  scenario: { intro: 'The web tier is down.', setup: ['echo secret-scenario-setup'] },
  completionBonus: 50,
  steps: [
    {
      id: 's1', title: 'Inspect containers', instructions: 'List the running containers.', kind: 'task',
      setup: ['echo secret-step-setup'],
      check: { type: 'command', command: 'echo secret-check', expect: { mode: 'exitCode', value: 0 }, timeoutMs: 15000 },
      hints: [{ id: 'h1', text: 'secret-hint' }], points: 25, hintCost: 5, wrongPenalty: 0, guessPenalty: 0,
    },
    {
      id: 's2', title: 'Name the service', instructions: 'Which service failed?', kind: 'question', setup: [],
      answer: { accepted: ['secret-answer'], normalize: 'trim_lower' },
      hints: [], points: 10, hintCost: 5, wrongPenalty: 2, guessPenalty: 5,
    },
  ],
};

function makeMentorDeps(overrides: Partial<Record<keyof AiMentorServiceDeps, unknown>> = {}) {
  const repo = (overrides.repo ?? {
    findLabById: vi.fn(async () => ({
      labId: 1,
      labName: 'Docker Deep Dive',
      description: 'Master Docker',
      isActive: true,
    })),
    findProLabByLabId: vi.fn(async () => ({ proLabId: 1, labId: 1, flagValues: mentorSpec })),
    listLabActivity: vi.fn(async () => []),
  }) as Mocked<AiMentorServiceDeps['repo']>;
  const lessons = (overrides.lessons ?? {
    findMentorLesson: vi.fn(async () => ({
      lessonId: 20,
      title: 'Docker Basics',
      content: 'Docker is a container runtime...',
      labId: 1,
      isPublished: true,
      modulePublished: true,
      coursePublished: true,
      kindVisible: true,
      courseId: 3,
    })),
  }) as Mocked<AiMentorServiceDeps['lessons']>;
  const courseAccess = (overrides.courseAccess ?? {
    getCourseAccess: vi.fn(async () => ({ canAccess: true, reason: null, message: null })),
  }) as Mocked<AiMentorServiceDeps['courseAccess']>;
  const entitlement = (overrides.entitlement ?? {
    assertLabAccess: vi.fn(async () => undefined),
  }) as Mocked<AiMentorServiceDeps['entitlement']>;
  const llm = (overrides.llm ?? {
    streamCompletion: vi.fn(async function* () {
      yield 'try ';
      yield 'docker ps';
    }),
  }) as Mocked<AiMentorServiceDeps['llm']>;
  const deps = {
    repo,
    lessons,
    courseAccess,
    entitlement,
    llm,
    model: 'gpt-test',
    systemPrompt: 'You are the DevOps Mentor.',
    sessionTtlSeconds: 7200,
    rateLimitMax: 30,
    rateLimitWindowSeconds: 3600,
  };
  return deps as unknown as AiMentorServiceDeps & {
    repo: typeof repo;
    lessons: typeof lessons;
    courseAccess: typeof courseAccess;
    entitlement: typeof entitlement;
    llm: typeof llm;
  };
}

async function drain(stream: AsyncGenerator<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const token of stream) {
    tokens.push(token);
  }
  return tokens;
}

function systemPromptOf(deps: ReturnType<typeof makeMentorDeps>): string {
  const messages = deps.llm.streamCompletion.mock.calls[0][0] as Array<{ role: string; content: string }>;
  return messages.find((m) => m.role === 'system')?.content ?? '';
}

describe('AiMentorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (redisClient as unknown as { store: Map<string, string> }).store.clear();
  });

  it('streams tokens, persists the session and records an activity event', async () => {
    const deps = makeMentorDeps();
    const service = new AiMentorService(deps);
    const tokens = await drain(service.sendMessage(7, 20, 1, 'how do I list containers?'));
    expect(tokens).toEqual(['try ', 'docker ps']);
    expect(deps.llm.streamCompletion).toHaveBeenCalledOnce();
    const calls = deps.llm.streamCompletion.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(calls.some((m) => m.role === 'system')).toBe(true);
    expect(calls.some((m) => m.role === 'user' && m.content.includes('list containers'))).toBe(true);

    const raw = await redisClient.get('ai_mentor:7:20');
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string) as { messages: Array<{ role: string; content: string }> };
    expect(stored.messages.at(-1)).toEqual({ role: 'assistant', content: 'try docker ps' });
  });

  it('enforces the 30/hour rate limit (429) after the cap', async () => {
    const deps = makeMentorDeps();
    const service = new AiMentorService(deps);
    redisClient.incr.mockResolvedValue(31 as never);
    await expect(drain(service.sendMessage(7, 20, null, 'hello'))).rejects.toMatchObject({ statusCode: 429 });
    redisClient.incr.mockImplementation(async () => 1);
  });

  it('throws 404 LESSON_NOT_FOUND for an unknown or unpublished lesson', async () => {
    const deps = makeMentorDeps();
    deps.lessons.findMentorLesson.mockResolvedValueOnce(null as never);
    const service = new AiMentorService(deps);
    await expect(service.getSession(7, 999, null)).rejects.toThrow(NotFoundError);

    deps.lessons.findMentorLesson.mockResolvedValueOnce({
      lessonId: 21, title: 'Draft', content: 'secret draft', labId: null,
      isPublished: true, modulePublished: true, coursePublished: false, kindVisible: true, courseId: 3,
    } as never);
    await expect(service.getSession(7, 21, null)).rejects.toMatchObject({ errors: [{ code: 'LESSON_NOT_FOUND' }] });
    expect(deps.llm.streamCompletion).not.toHaveBeenCalled();
  });

  it('refuses a lesson of a course the learner cannot access (403 COURSE_ACCESS_DENIED)', async () => {
    const deps = makeMentorDeps();
    deps.courseAccess.getCourseAccess.mockResolvedValue({ canAccess: false, reason: 'premium_required', message: 'Upgrade.' } as never);
    const service = new AiMentorService(deps);
    await expect(drain(service.sendMessage(7, 20, null, 'hi'))).rejects.toMatchObject({
      statusCode: 403,
      errors: [{ code: 'COURSE_ACCESS_DENIED', reason: 'premium_required' }],
    });
    expect(deps.llm.streamCompletion).not.toHaveBeenCalled();
  });

  it('rejects a lesson that does not belong to the given lab (422)', async () => {
    const deps = makeMentorDeps();
    const service = new AiMentorService(deps);
    await expect(service.getSession(7, 20, 2)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('general mode sends no course, lesson or lab content', async () => {
    const deps = makeMentorDeps();
    const service = new AiMentorService(deps);
    await drain(service.sendMessage(7, null, null, 'what is devops?'));
    expect(systemPromptOf(deps)).toBe('You are the DevOps Mentor.');
    expect(deps.lessons.findMentorLesson).not.toHaveBeenCalled();
    expect(deps.repo.findLabById).not.toHaveBeenCalled();
    expect(await redisClient.get('ai_mentor:7:general')).toBeTruthy();
  });

  it('lab mode sends only the current step instructions, never checks, setup, answers or hints', async () => {
    const deps = makeMentorDeps();
    deps.repo.listLabActivity.mockResolvedValue([{ details: { stepId: 's1' } }] as never);
    const service = new AiMentorService(deps);
    await drain(service.sendMessage(7, null, 1, 'stuck'));
    const prompt = systemPromptOf(deps);
    expect(prompt).toContain('The web tier is down.');
    expect(prompt).toContain('Which service failed?');
    expect(prompt).not.toContain('List the running containers.');
    expect(prompt).not.toMatch(/secret-/);
    expect(deps.entitlement.assertLabAccess).toHaveBeenCalledWith(7, 1);
    expect(await redisClient.get('ai_mentor:7:lab-1')).toBeTruthy();
  });

  it('injects conversation history into the LLM prompt', async () => {
    const deps = makeMentorDeps();
    const service = new AiMentorService(deps);
    await redisClient.set(
      'ai_mentor:7:20',
      JSON.stringify({
        sessionKey: 'mentor_7_20_aaaa',
        userId: 7,
        contextLessonId: 20,
        contextLabId: null,
        createdAt: '2026-02-01T10:00:00Z',
        ttlSeconds: 7200,
        messages: [
          { role: 'user', content: 'prior question' },
          { role: 'assistant', content: 'prior answer' },
        ],
      }),
    );
    await drain(service.sendMessage(7, 20, null, 'next question'));
    const messages = deps.llm.streamCompletion.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages.some((m) => m.content === 'prior answer')).toBe(true);
  });
});

describe('TrackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function trackRow() {
    return {
      trackId: 5,
      trackName: 'DevOps Engineer',
      slug: 'devops-engineer',
      description: 'The whole path',
      difficultyId: 2,
      difficultyName: 'Intermediate',
      categoryId: null,
      categoryName: null,
      totalLabs: 0,
      isActive: true,
      isPremium: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
  }

  /** Two required courses, one optional course, and a stray lab row that must be ignored. */
  function contentRows() {
    return [
      { trackId: 5, contentType: 'course' as const, contentId: 1, displayOrder: 1, required: true, title: 'Linux' },
      { trackId: 5, contentType: 'course' as const, contentId: 2, displayOrder: 2, required: true, title: 'Networking' },
      { trackId: 5, contentType: 'course' as const, contentId: 3, displayOrder: 3, required: false, title: 'Git' },
      { trackId: 5, contentType: 'lab' as const, contentId: 9, displayOrder: 4, required: true, title: 'Stray lab' },
    ];
  }

  function courseProgress(courseId: number, pct: number) {
    return { courseId, courseTitle: `C${courseId}`, progressPercentage: pct, isCompleted: pct === 100 };
  }

  function makeTrackDeps(progressByCourse: Record<number, number | 'missing'> = {}) {
    const repo: Mocked<TrackServiceDeps['repo']> = {
      listTracks: vi.fn(async () => [trackRow()]),
      findTrackById: vi.fn(async () => trackRow()),
      listTrackContent: vi.fn(async () => contentRows()),
    };
    const progress = {
      getCourseProgress: vi.fn(async (_userId: number, courseId: number) => {
        const pct = progressByCourse[courseId] ?? 0;
        if (pct === 'missing') {
          throw new NotFoundError('Course not found.');
        }
        return courseProgress(courseId, pct);
      }),
    };
    return { repo, progress, deps: { repo, progress } as unknown as TrackServiceDeps };
  }

  it('lists only course content and ignores lab rows', async () => {
    const { deps } = makeTrackDeps({ 1: 100 });
    const detail = await new TrackService(deps).getTrackDetail(5, 7);
    expect(detail.items.map((item) => item.contentId)).toEqual([1, 2, 3]);
    expect(detail.totalCourses).toBe(3);
    expect(detail.items.every((item) => item.contentType === 'course')).toBe(true);
    expect(detail.items[0].completed).toBe(true);
    expect(detail.items[1].completed).toBe(false);
  });

  it('computes progress from the course progress service (required courses only)', async () => {
    const { deps, progress } = makeTrackDeps({ 1: 100, 2: 40 });
    const result = await new TrackService(deps).getTrackProgress(7, 5);
    expect(progress.getCourseProgress).toHaveBeenCalledWith(7, 1);
    expect(progress.getCourseProgress).toHaveBeenCalledWith(7, 2);
    expect(result.totalRequired).toBe(2);
    expect(result.completedRequired).toBe(1);
    expect(result.progressPercentage).toBe(50);
    expect(result.isCompleted).toBe(false);
    expect(result.items.find((item) => item.contentId === 2)?.progressPercentage).toBe(40);
  });

  it('marks the track completed when every required course is completed', async () => {
    const { deps } = makeTrackDeps({ 1: 100, 2: 100 });
    const result = await new TrackService(deps).getTrackProgress(7, 5);
    expect(result.isCompleted).toBe(true);
    expect(result.progressPercentage).toBe(100);
  });

  it('is a pure read: reading a completed track writes no TRACK_COMPLETED event', async () => {
    const { deps } = makeTrackDeps({ 1: 100, 2: 100 });
    const service = new TrackService(deps);
    await service.getTrackProgress(7, 5);
    await service.getTrackProgress(7, 5);
    const recordEvent = vi.mocked(
      (await import('../../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('treats an unpublished course (progress 404) as not started instead of failing', async () => {
    const { deps } = makeTrackDeps({ 1: 'missing', 2: 100 });
    const result = await new TrackService(deps).getTrackProgress(7, 5);
    expect(result.items.find((item) => item.contentId === 1)).toMatchObject({ completed: false, progressPercentage: 0 });
    expect(result.completedRequired).toBe(1);
  });

  it('rethrows unexpected progress errors', async () => {
    const { deps, progress } = makeTrackDeps();
    progress.getCourseProgress.mockRejectedValue(new Error('redis down'));
    await expect(new TrackService(deps).getTrackProgress(7, 5)).rejects.toThrow('redis down');
  });

  it('reports 0 percent and not completed for a track without required courses', async () => {
    const { deps, repo } = makeTrackDeps();
    repo.listTrackContent.mockResolvedValue([{ trackId: 5, contentType: 'course', contentId: 3, displayOrder: 1, required: false, title: 'Git' }] as never);
    const result = await new TrackService(deps).getTrackProgress(7, 5);
    expect(result).toMatchObject({ totalRequired: null, isCompleted: false, progressPercentage: 0 });
  });

  it('throws 404 for an inactive or unknown track', async () => {
    const { deps, repo } = makeTrackDeps();
    repo.findTrackById.mockResolvedValueOnce(null as never);
    await expect(new TrackService(deps).getTrackDetail(999, null)).rejects.toThrow(NotFoundError);
    repo.findTrackById.mockResolvedValueOnce({ ...trackRow(), isActive: false } as never);
    await expect(new TrackService(deps).getTrackProgress(7, 5)).rejects.toThrow(NotFoundError);
  });

  it('the default track is the active track with the lowest id', async () => {
    const { deps, repo } = makeTrackDeps();
    repo.listTracks.mockResolvedValue([{ ...trackRow(), trackId: 8 }, { ...trackRow(), trackId: 3 }] as never);
    await expect(new TrackService(deps).getDefaultTrack()).resolves.toMatchObject({ trackId: 3 });
    repo.listTracks.mockResolvedValue([] as never);
    await expect(new TrackService(deps).getDefaultTrack()).rejects.toThrow(NotFoundError);
  });
});
