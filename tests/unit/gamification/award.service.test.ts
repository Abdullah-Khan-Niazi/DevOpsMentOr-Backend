import { describe, expect, it, vi } from 'vitest';
import { AwardService, type AwardServiceDeps, type Tx } from '../../../src/features/gamification/services/award.service';
import {
  awardKeys,
  escapeLike,
  formatAwardDescription,
  parseAwardKey,
} from '../../../src/features/gamification/config/award-keys';
import type { LedgerInsert } from '../../../src/features/gamification/repositories/ledger.repository';
import { NotFoundError } from '../../../src/shared/errors';

/**
 * In-memory ledger that mimics points_history + the users row lock. Every
 * call is appended to `calls` so the tests can assert statement order.
 */
function createHarness(options: { users?: number[] } = {}) {
  const users = new Set(options.users ?? [1, 2]);
  const rows: Array<LedgerInsert & { historyId: number }> = [];
  const calls: string[] = [];
  let txCounter = 0;

  const ledger: AwardServiceDeps['ledger'] = {
    lockUser: vi.fn(async (_tx: Tx, userId: number) => {
      calls.push(`lock:${userId}`);
      return users.has(userId);
    }),
    hasKey: vi.fn(async (_tx: Tx, userId: number, key: string) => {
      calls.push(`hasKey:${key}`);
      return rows.some((row) => row.userId === userId && row.description.startsWith(`[k:${key}] `));
    }),
    latestBalance: vi.fn(async (_tx: Tx, userId: number) => {
      calls.push('latestBalance');
      const mine = rows.filter((row) => row.userId === userId);
      return mine.length > 0 ? mine[mine.length - 1].pointsBalanceAfter : 0;
    }),
    insert: vi.fn(async (_tx: Tx, row: LedgerInsert) => {
      calls.push(`insert:${row.description}`);
      const historyId = rows.length + 1;
      rows.push({ ...row, historyId });
      return historyId;
    }),
  };

  const deps: AwardServiceDeps = {
    ledger,
    transaction: async (fn) => {
      txCounter += 1;
      calls.push('begin');
      const result = await fn({ id: txCounter } as unknown as Tx);
      calls.push('commit');
      return result;
    },
  };

  return {
    service: new AwardService(deps),
    rows,
    calls,
    ledger,
  };
}

const labStep = (userId = 1, points = 25) => ({
  userId,
  key: awardKeys.labStep(1, 'checkpoint_2_mem'),
  points,
  sourceType: 'lab_complete' as const,
  sourceId: 1,
  label: 'Step passed: Memory Audit Baseline File',
});

describe('AwardService', () => {
  it('locks the user row as the first statement of the transaction', async () => {
    const { service, calls } = createHarness();

    await service.applyLocked(labStep());

    expect(calls[0]).toBe('begin');
    expect(calls[1]).toBe('lock:1');
    expect(calls.slice(2).every((call) => !call.startsWith('lock'))).toBe(true);
  });

  it('writes exactly one insert for a positive lab_complete award, with pointsChange equal to points', async () => {
    const { service, rows, ledger } = createHarness();

    const result = await service.applyLocked(labStep(1, 30));

    expect(ledger.insert).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 1, pointsChange: 30, pointsBalanceAfter: 30, sourceType: 'lab_complete' });
    expect(result).toMatchObject({ applied: true, pointsChange: 30, balance: 30 });
  });

  it('is idempotent by key: the second apply writes nothing', async () => {
    const { service, rows } = createHarness();

    const first = await service.applyLocked(labStep());
    const second = await service.applyLocked(labStep());

    expect(first).toMatchObject({ applied: true, pointsChange: 25, balance: 25 });
    expect(second).toEqual({ applied: false, historyId: null, pointsChange: 0, balance: 25 });
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('[k:lab_step:1:checkpoint_2_mem] Step passed: Memory Audit Baseline File');
  });

  it('computes the balance from the latest row, so a penalty lowers it (not MAX)', async () => {
    const { service, rows } = createHarness();

    await service.applyLocked(labStep());
    const penalty = await service.applyLocked({
      userId: 1,
      key: awardKeys.labHint(1, 'checkpoint_2_mem', 'h1'),
      points: -5,
      sourceType: 'penalty',
      sourceId: 1,
      label: 'Hint revealed',
    });
    const after = await service.applyLocked({
      userId: 1,
      key: awardKeys.quizWrong(9, 4),
      points: -2,
      sourceType: 'penalty',
      sourceId: 3,
      label: 'Wrong answer',
    });

    expect(penalty.balance).toBe(20);
    expect(after.balance).toBe(18);
    expect(rows.map((row) => row.pointsBalanceAfter)).toEqual([25, 20, 18]);
  });

  it('lets the balance go negative (no clamp)', async () => {
    const { service } = createHarness();
    const result = await service.applyLocked({
      userId: 2,
      key: awardKeys.labHint(4, 's1', 'h1'),
      points: -5,
      sourceType: 'penalty',
      sourceId: 4,
      label: 'Hint revealed',
    });
    expect(result).toMatchObject({ applied: true, balance: -5 });
  });

  it('writes no row for zero points', async () => {
    const { service, rows, ledger } = createHarness();
    const result = await service.applyLocked(labStep(1, 0));
    expect(result).toMatchObject({ applied: false, historyId: null, pointsChange: 0 });
    expect(rows).toHaveLength(0);
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for a missing user and never writes', async () => {
    const { service, ledger } = createHarness({ users: [1] });
    await expect(service.applyLocked(labStep(99))).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.applyLocked(labStep(0))).rejects.toBeInstanceOf(NotFoundError);
    expect(ledger.insert).not.toHaveBeenCalled();
  });

  it('rejects invalid keys and non-integer points', async () => {
    const { service } = createHarness();
    await expect(service.applyLocked({ ...labStep(), key: 'bad key' })).rejects.toThrow('Invalid award key');
    await expect(service.applyLocked({ ...labStep(), key: 'lesson:%' })).rejects.toThrow('Invalid award key');
    await expect(service.applyLocked({ ...labStep(), points: 1.5 })).rejects.toThrow('integer');
  });

  it('refuses ledger access outside withUserLock or for another user', async () => {
    const { service } = createHarness();
    await expect(service.apply({} as Tx, labStep())).rejects.toThrow('withUserLock');
    await expect(
      service.withUserLock(1, (tx) => service.apply(tx, labStep(2))),
    ).rejects.toThrow('same user');
    await expect(service.withUserLock(1, (_tx) => service.balance({} as Tx, 1))).rejects.toThrow('withUserLock');
  });

  it('refuses nested withUserLock instead of self-deadlocking', async () => {
    const { service } = createHarness();
    await expect(service.withUserLock(1, () => service.withUserLock(1, async () => 1))).rejects.toThrow(
      'must not be nested',
    );
    await expect(service.withUserLock(1, () => service.applyLocked(labStep()))).rejects.toThrow('must not be nested');
  });

  it('applies several awards in one locked unit and reports the running balance', async () => {
    const { service, calls } = createHarness();
    const result = await service.withUserLock(1, async (tx) => {
      await service.apply(tx, labStep());
      await service.apply(tx, { ...labStep(), key: awardKeys.labDone(1), points: 50, label: 'Lab completed' });
      return { has: await service.hasKey(tx, 1, awardKeys.labDone(1)), balance: await service.balance(tx, 1) };
    });
    expect(result).toEqual({ has: true, balance: 75 });
    expect(calls.filter((call) => call === 'begin')).toHaveLength(1);
  });
});

describe('award keys', () => {
  it('builds keys that match the key pattern', () => {
    expect(awardKeys.labHint(1, 'checkpoint_1_ps', 'h1')).toBe('lab_hint:1:checkpoint_1_ps:h1');
    expect(awardKeys.admin()).toMatch(/^admin:[0-9a-f-]{36}$/);
  });

  it('escapes LIKE wildcards so "_" in step ids cannot match other keys', () => {
    expect(escapeLike('[k:lab_hint:1:s_1:h1] ')).toBe('[k:lab!_hint:1:s!_1:h1] ');
    expect(escapeLike('100%!')).toBe('100!%!!');
  });

  it('caps and flattens the label', () => {
    const description = formatAwardDescription('lesson:1', `  a\n b ${'x'.repeat(300)}`);
    expect(description.startsWith('[k:lesson:1] a b ')).toBe(true);
    expect(description.length).toBe('[k:lesson:1] '.length + 200);
  });

  it('parses keyed and legacy descriptions', () => {
    expect(parseAwardKey('[k:lab_step:1:checkpoint_2_mem] Step passed')).toEqual({
      key: 'lab_step:1:checkpoint_2_mem',
      kind: 'lab_step',
      label: 'Step passed',
    });
    expect(parseAwardKey('[k:daily:2026-11-21] Daily learning bonus').kind).toBe('daily');
    expect(parseAwardKey('Completed lab 3')).toEqual({ key: null, kind: 'legacy', label: 'Completed lab 3' });
    expect(parseAwardKey(null)).toEqual({ key: null, kind: 'legacy', label: '' });
    expect(parseAwardKey('[k:unknown_kind:1] x')).toEqual({ key: 'unknown_kind:1', kind: 'legacy', label: 'x' });
    expect(parseAwardKey('[k:not a key] x').kind).toBe('legacy');
  });
});
