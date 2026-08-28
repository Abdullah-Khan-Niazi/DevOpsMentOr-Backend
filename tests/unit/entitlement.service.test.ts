import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../../src/shared/errors';
import { EntitlementService, type EntitlementServiceDeps } from '../../src/features/labs/services/EntitlementService';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeRepo(): Mocked<EntitlementServiceDeps['repo']> {
  return { findLabById: vi.fn(async () => null) };
}

vi.mock('../../src/features/billing/services/entitlement.service', () => ({
  entitlementService: {
    getUserPlanType: vi.fn(async () => 'free'),
    assertLabAccess: vi.fn(async () => undefined),
  },
}));

import { entitlementService as billingEntitlementService } from '../../src/features/billing/services/entitlement.service';

const mockedBillingEntitlement = billingEntitlementService as unknown as {
  getUserPlanType: ReturnType<typeof vi.fn>;
  assertLabAccess: ReturnType<typeof vi.fn>;
};

describe('F6 EntitlementService (F9 gate seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBillingEntitlement.getUserPlanType.mockResolvedValue('free');
    mockedBillingEntitlement.assertLabAccess.mockResolvedValue(undefined);
  });

  it('resolves the plan tier from the F9 entitlement service', async () => {
    mockedBillingEntitlement.getUserPlanType.mockResolvedValue('enterprise');
    const service = new EntitlementService({ repo: makeRepo() });
    await expect(service.getPlanTier(7)).resolves.toBe('enterprise');
    expect(mockedBillingEntitlement.getUserPlanType).toHaveBeenCalledWith(7);
  });

  it('defaults to free when the F9 service reports no active subscription', async () => {
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
      mockedBillingEntitlement.getUserPlanType.mockResolvedValue(plan);
      await expect(service.getLabTtlHours(7)).resolves.toBe(hours);
    }
  });

  it('maps tiers to extension limits: free 1, student 3, premium 3, enterprise 10', async () => {
    const service = new EntitlementService({ repo: makeRepo() });
    for (const [plan, limit] of [
      ['free', 1],
      ['student', 3],
      ['premium', 3],
      ['enterprise', 10],
    ] as const) {
      mockedBillingEntitlement.getUserPlanType.mockResolvedValue(plan);
      await expect(service.getExtensionLimit(7)).resolves.toBe(limit);
    }
  });

  it('denies 403 on premium labs for free-tier learners; allows paid tiers', async () => {
    const repo = makeRepo();
    repo.findLabById.mockResolvedValue({ labId: 1, isPremium: true } as never);
    const service = new EntitlementService({ repo });

    mockedBillingEntitlement.assertLabAccess.mockRejectedValue(
      new ForbiddenError('This lab requires a premium subscription.'),
    );
    await expect(service.assertLabAccess(7, 1)).rejects.toThrow(ForbiddenError);
    expect(mockedBillingEntitlement.assertLabAccess).toHaveBeenCalledWith(7, 1);

    mockedBillingEntitlement.assertLabAccess.mockResolvedValue(undefined);
    await expect(service.assertLabAccess(7, 1)).resolves.toBeUndefined();
  });

  it('skips the gate for non-premium labs without consulting the F9 service', async () => {
    const repo = makeRepo();
    repo.findLabById.mockResolvedValue({ labId: 2, isPremium: false } as never);
    const service = new EntitlementService({ repo });
    await expect(service.assertLabAccess(7, 2)).resolves.toBeUndefined();
    expect(mockedBillingEntitlement.assertLabAccess).not.toHaveBeenCalled();
  });
});