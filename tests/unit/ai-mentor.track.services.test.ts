import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/shared/errors';
import { AiMentorService, type AiMentorServiceDeps } from '../../src/features/labs/services/AiMentorService';
import { TrackService, type TrackServiceDeps } from '../../src/features/labs/services/TrackService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

vi.mock('../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

vi.mock('../../src/app/cache/redis', () => {
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

import { redisClient } from '../../src/app/cache/redis';

function makeMentorDeps(overrides: Partial<Record<keyof AiMentorServiceDeps, unknown>> = {}) {
  const repo = (overrides.repo ?? {
    findLessonById: vi.fn(async () => ({
      lessonId: 20,
      title: 'Docker Basics',
      content: 'Docker is a container runtime...',
    })),
    findLabById: vi.fn(async () => ({
      labId: 1,
      labName: 'Docker Deep Dive',
      description: 'Master Docker',
    })),
  }) as Mocked<AiMentorServiceDeps['repo']>;
  const llm = (overrides.llm ?? {
    streamCompletion: vi.fn(async function* () {
      yield 'try ';
      yield 'docker ps';
    }),
  }) as Mocked<AiMentorServiceDeps['llm']>;
  const deps: AiMentorServiceDeps = {
    repo,
    llm,
    model: 'gpt-test',
    systemPrompt: 'You are the DevOps Mentor.',
    sessionTtlSeconds: 7200,
    rateLimitMax: 30,
    rateLimitWindowSeconds: 3600,
  };
  return deps;
}

describe('F6 AiMentorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams tokens, persists the session and records an activity event', async () => {
    const deps = makeMentorDeps();
    const service = new AiMentorService(deps);
    const tokens: string[] = [];
    for await (const token of service.sendMessage(7, 20, 1, 'how do I list containers?')) {
      tokens.push(token);
    }
    expect(tokens).toEqual(['try ', 'docker ps']);
    expect(deps.llm.streamCompletion).toHaveBeenCalledOnce();
    const calls = deps.llm.streamCompletion.mock.calls[0][0] as Array<{ role: string }>;
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
    await expect(
      (async () => {
        for await (const _ of service.sendMessage(7, 20, null, 'hello')) {
          // consume
        }
      })(),
    ).rejects.toMatchObject({ statusCode: 429 });
    redisClient.incr.mockImplementation(async () => 1);
  });

  it('throws 404 for an unknown lesson', async () => {
    const deps = makeMentorDeps();
    deps.repo.findLessonById.mockResolvedValue(null as never);
    const service = new AiMentorService(deps);
    await expect(service.getSession(7, 999, null)).rejects.toThrow(NotFoundError);
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
    for await (const _ of service.sendMessage(7, 20, null, 'next question')) {
      // consume
    }
    const messages = deps.llm.streamCompletion.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(messages.some((m) => m.content === 'prior answer')).toBe(true);
  });
});

describe('F6 TrackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function trackRow() {
    return {
      trackId: 5,
      trackName: 'Containerization',
      slug: 'containerization',
      description: 'Master containers',
      difficultyId: 2,
      difficultyName: 'Intermediate',
      categoryId: null,
      categoryName: null,
      totalLabs: 2,
      isActive: true,
      isPremium: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
  }

  function contentRows() {
    return [
      { trackId: 5, contentType: 'lab' as const, contentId: 1, displayOrder: 1, required: true, title: 'Docker Deep Dive' },
      { trackId: 5, contentType: 'lab' as const, contentId: 2, displayOrder: 2, required: true, title: 'K8s Basics' },
      { trackId: 5, contentType: 'course' as const, contentId: 20, displayOrder: 3, required: false, title: 'Docker Concepts' },
    ];
  }

  function makeTrackRepo(): Mocked<TrackServiceDeps['repo']> {
    return {
      listTracks: vi.fn(async () => [trackRow()]),
      findTrackById: vi.fn(async () => trackRow()),
      listTrackContent: vi.fn(async () => contentRows()),
      listCompletedLabIdsForUser: vi.fn(async () => [1]),
      listCompletedLessonIdsForUser: vi.fn(async () => []),
      hasTrackCompletionEvent: vi.fn(async () => false),
    };
  }

  it('computes progress from activity events only (never user_progress)', async () => {
    const repo = makeTrackRepo();
    const service = new TrackService({ repo });
    const progress = await service.getTrackProgress(7, 5);

    expect(progress.progressPercentage).toBe(50);
    expect(progress.isCompleted).toBe(false);
    expect(progress.completedRequired).toBe(1);
    expect(progress.totalRequired).toBe(2);
    expect(progress.items[0].completed).toBe(true);
    expect(progress.items[1].completed).toBe(false);
    expect(repo.listCompletedLabIdsForUser).toHaveBeenCalledWith(7);
  });

  it('records TRACK_COMPLETED once when the last required item completes', async () => {
    const repo = makeTrackRepo();
    repo.listCompletedLabIdsForUser.mockResolvedValue([1, 2] as never);
    const service = new TrackService({ repo });
    const progress = await service.getTrackProgress(7, 5);

    expect(progress.isCompleted).toBe(true);
    expect(progress.progressPercentage).toBe(100);
    const recordEvent = vi.mocked(
      (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).toHaveBeenCalledWith(
      7,
      'TRACK_COMPLETED',
      expect.objectContaining({ trackId: 5 }),
    );
  });

  it('does not double-record TRACK_COMPLETED on subsequent reads', async () => {
    const repo = makeTrackRepo();
    repo.listCompletedLabIdsForUser.mockResolvedValue([1, 2] as never);
    repo.hasTrackCompletionEvent.mockResolvedValue(true as never);
    const service = new TrackService({ repo });
    await service.getTrackProgress(7, 5);
    const recordEvent = vi.mocked(
      (await import('../../src/features/progress/services/ActivityLogService')).activityLogService.recordEvent,
    );
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('throws 404 for an inactive or unknown track', async () => {
    const repo = makeTrackRepo();
    repo.findTrackById.mockResolvedValue(null as never);
    const service = new TrackService({ repo });
    await expect(service.getTrackDetail(999, null)).rejects.toThrow(NotFoundError);
  });
});