import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../../src/shared/errors';
import { SherlockService, type SherlockServiceDeps } from '../../../src/features/labs/services/SherlockService';
import { activityLogService } from '../../../src/features/progress/services/ActivityLogService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

vi.mock('../../../src/features/progress/services/ActivityLogService', () => ({
  activityLogService: {
    recordEvent: vi.fn(async () => undefined),
    getActivityHistory: vi.fn(async () => []),
  },
}));

function sherlockRow() {
  return {
    sherlockId: 2,
    labId: 2,
    evidenceFileUrl: 'https://cdn.example.com/evidence.pcap',
    evidenceFileSize: 2048,
    fileHash: 'abc123',
    questions: [
      { id: 'q1', text: 'Which port?', hint: 'Check the SYN packets' },
      { id: 'q2', text: 'What user?', hint: null },
    ],
    answers: [
      { id: 'q1', answer: '8080' },
      { id: 'q2', answer: 'root' },
    ],
    requiredCorrectAnswers: 2,
  };
}

function instanceRow() {
  return {
    instanceId: 42,
    userId: 7,
    vpnId: 1,
    labId: 1,
    labType: 'pro_lab' as const,
    status: 'running' as const,
    startedAt: new Date('2026-02-01T10:00:00Z'),
    expiresAt: new Date('2026-02-01T12:00:00Z'),
    terminatedAt: null,
  };
}

function makeRepo(): Mocked<SherlockServiceDeps['repo']> {
  return {
    findSherlockByLabId: vi.fn(async () => sherlockRow()),
    findProLabByLabId: vi.fn(async () => null),
    hasLabCompletionEvent: vi.fn(async () => false),
    findLabStartTime: vi.fn(async () => new Date('2026-02-01T10:00:00Z')),
    findAnyActiveInstanceForUser: vi.fn(async () => instanceRow()),
  };
}

describe('SherlockService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes when all answers are correct (case/whitespace-insensitive) and records LAB_COMPLETED', async () => {
    const service = new SherlockService({ repo: makeRepo() });
    const result = await service.submitAnswers(7, 2, [
      { questionId: 'q1', answer: ' 8080 ' },
      { questionId: 'q2', answer: 'ROOT' },
    ]);
    expect(result.isPassed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.results).toEqual([
      { questionId: 'q1', passed: true },
      { questionId: 'q2', passed: true },
    ]);
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(
      7,
      'LAB_COMPLETED',
      expect.objectContaining({ labId: 2, labType: 'sherlock', instanceId: 42 }),
    );
  });

  it('fails on wrong answers, records nothing and never leaks the answers', async () => {
    const service = new SherlockService({ repo: makeRepo() });
    const result = await service.submitAnswers(7, 2, [
      { questionId: 'q1', answer: '9090' },
      { questionId: 'q2', answer: 'admin' },
    ]);
    expect(result.isPassed).toBe(false);
    expect(result.score).toBe(0);
    expect(JSON.stringify(result)).not.toContain('8080');
    expect(activityLogService.recordEvent).not.toHaveBeenCalled();
  });

  it('counts a missing answer as failed and an unknown question id as failed', async () => {
    const service = new SherlockService({ repo: makeRepo() });
    const result = await service.submitAnswers(7, 2, [
      { questionId: 'q1', answer: '8080' },
      { questionId: 'zz', answer: 'x' },
    ]);
    expect(result.results).toEqual([
      { questionId: 'q1', passed: true },
      { questionId: 'q2', passed: false },
      { questionId: 'zz', passed: false },
    ]);
    expect(result.isPassed).toBe(false);
  });

  it('completes with a null instance and time when no instance is active', async () => {
    const repo = makeRepo();
    repo.findAnyActiveInstanceForUser.mockResolvedValue(null as never);
    const service = new SherlockService({ repo });
    await service.submitAnswers(7, 2, [
      { questionId: 'q1', answer: '8080' },
      { questionId: 'q2', answer: 'root' },
    ]);
    expect(activityLogService.recordEvent).toHaveBeenCalledWith(
      7,
      'LAB_COMPLETED',
      expect.objectContaining({ instanceId: null, timeTakenSeconds: null }),
    );
  });

  it('throws 409 when the lab was already completed', async () => {
    const repo = makeRepo();
    repo.hasLabCompletionEvent.mockResolvedValue(true as never);
    const service = new SherlockService({ repo });
    await expect(
      service.submitAnswers(7, 2, [{ questionId: 'q1', answer: '8080' }]),
    ).rejects.toThrow(ConflictError);
    expect(activityLogService.recordEvent).not.toHaveBeenCalled();
  });

  it('throws 404 when the lab has no sherlock configuration', async () => {
    const repo = makeRepo();
    repo.findSherlockByLabId.mockResolvedValue(null as never);
    const service = new SherlockService({ repo });
    await expect(service.submitAnswers(7, 9, [])).rejects.toThrow(NotFoundError);
  });
});
