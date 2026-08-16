import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../../src/shared/errors';
import { EntitlementService, type EntitlementServiceDeps } from '../../src/features/labs/services/EntitlementService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeRepo(): Mocked<EntitlementServiceDeps['repo']> {
  return { findLabById: vi.fn(async () => null) };
}

/** Fake drizzle chain: select().from().where().orderBy().limit() */
function planChain(rows: Array<{ planType: string }>) {
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      }),
    })),
  };
}

vi.mock('../../src/app/database', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '../../src/app/database';

describe('F6 EntitlementService (F9 runtime gate seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the plan tier from the active subscription row', async () => {
    const chain = planChain([{ planType: 'enterprise' }]);
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(chain.select);
    const service = new EntitlementService({ repo: makeRepo() });
    await expect(service.getPlanTier(7)).resolves.toBe('enterprise');
  });

  it('defaults to free when no active subscription exists', async () => {
    const chain = planChain([]);
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(chain.select);
    const service = new EntitlementService({ repo: makeRepo() });
    await expect(service.getPlanTier(7)).resolves.toBe('free');
  });

  it('maps tiers to TTL hours: free 2, student 4, premium 4, enterprise 8', async () => {
    const service = new EntitlementService({ repo: makeRepo() });
    for (const [plan, hours] of [
      ['free', 2],
      ['student', 4],
      ['premium', 4],
      ['enterprise', 8],
    ] as const) {
      const chain = planChain([{ planType: plan }]);
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(chain.select);
      await expect(service.getLabTtlHours(7)).resolves.toBe(hours);
    }
  });

  it('denies 403 on premium labs for free-tier learners; allows paid tiers', async () => {
    const repo = makeRepo();
    repo.findLabById.mockResolvedValue({
      labId: 1,
      isPremium: true,
    } as never);
    const service = new EntitlementService({ repo });

    const chain = planChain([]);
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(chain.select);
    await expect(service.assertLabAccess(7, 1)).rejects.toThrow(ForbiddenError);

    const paid = planChain([{ planType: 'premium' }]);
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(paid.select);
    await expect(service.assertLabAccess(7, 1)).resolves.toBeUndefined();
  });

  it('skips the gate for non-premium labs even without a subscription', async () => {
    const repo = makeRepo();
    repo.findLabById.mockResolvedValue({ labId: 2, isPremium: false } as never);
    const service = new EntitlementService({ repo });
    const chain = planChain([]);
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(chain.select);
    await expect(service.assertLabAccess(7, 2)).resolves.toBeUndefined();
  });
});