import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../../../src/shared/errors';
import {
  EntitlementService,
  type EntitlementServiceDeps,
} from '../../../src/features/billing/services/entitlement.service';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeDeps(overrides: Partial<Mocked<EntitlementServiceDeps>> = {}): Mocked<EntitlementServiceDeps> {
  return {
    repo: {
      findActiveByUser: vi.fn(async () => null),
      findActiveOrgSubscription: vi.fn(async () => null),
      getOrgId: vi.fn(async () => null),
      countOrgMembers: vi.fn(async () => 0),
      getPlanSeatLimit: vi.fn(async () => null),
      findLabPremiumFlag: vi.fn(async () => false),
      findCoursePremiumFlag: vi.fn(async () => false),
    },
    seatFallback: vi.fn(() => 10),
    ...overrides,
  };
}

const PAID = {
  subscriptionId: 1,
  userId: 7,
  organizationId: null,
  planName: 'Premium',
  planType: 'premium' as const,
  stripeSubscriptionId: 'sub_123',
  startDate: new Date(),
  endDate: new Date(Date.now() + 30 * 86_400_000),
  autoRenew: true,
  isActive: true,
  cancelledAt: null,
  createdAt: new Date(),
};

describe('F9 EntitlementService (AC-01, AC-13, invariant 11)', () => {
  it('resolves individual plan tier from an active subscription', async () => {
    const deps = makeDeps();
    (deps.repo.findActiveByUser as ReturnType<typeof vi.fn>).mockResolvedValue(PAID);
    const service = new EntitlementService(deps);
    await expect(service.getUserPlanType(7)).resolves.toBe('premium');
  });

  it('falls through to the org subscription when no individual row exists', async () => {
    const deps = makeDeps();
    (deps.repo.getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (deps.repo.findActiveOrgSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...PAID,
      planType: 'enterprise',
    });
    const service = new EntitlementService(deps);
    await expect(service.getUserPlanType(7)).resolves.toBe('enterprise');
  });

  it('defaults to free when neither individual nor org subscription exists', async () => {
    const service = new EntitlementService(makeDeps());
    await expect(service.getUserPlanType(7)).resolves.toBe('free');
  });

  it('allows free content without any subscription (free_content)', async () => {
    const deps = makeDeps();
    (deps.repo.findLabPremiumFlag as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const service = new EntitlementService(deps);
    await expect(service.checkAccess(7, 'lab', 1)).resolves.toEqual({
      allowed: true,
      reason: 'free_content',
      planType: null,
    });
  });

  it('denies premium content for free-tier users with 403', async () => {
    const deps = makeDeps();
    (deps.repo.findLabPremiumFlag as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const service = new EntitlementService(deps);
    await expect(service.assertLabAccess(7, 1)).rejects.toThrow(ForbiddenError);
    await expect(service.checkAccess(7, 'lab', 1)).resolves.toEqual({
      allowed: false,
      reason: 'no_subscription',
      planType: 'free',
    });
  });

  it('grants premium access to a paid individual subscriber', async () => {
    const deps = makeDeps();
    (deps.repo.findCoursePremiumFlag as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (deps.repo.findActiveByUser as ReturnType<typeof vi.fn>).mockResolvedValue(PAID);
    const service = new EntitlementService(deps);
    await expect(service.assertCourseAccess(7, 4)).resolves.toBeUndefined();
    await expect(service.checkAccess(7, 'course', 4)).resolves.toEqual({
      allowed: true,
      reason: 'active_subscription',
      planType: 'premium',
    });
  });

  it('blocks org members when the org exceeds its seat limit', async () => {
    const deps = makeDeps();
    (deps.repo.findLabPremiumFlag as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (deps.repo.getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (deps.repo.findActiveOrgSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...PAID,
      planType: 'premium',
    });
    (deps.repo.countOrgMembers as ReturnType<typeof vi.fn>).mockResolvedValue(11);
    const service = new EntitlementService(deps);
    await expect(service.assertLabAccess(7, 1)).rejects.toThrow(
      expect.objectContaining({ message: expect.stringContaining('ORG_SEAT_LIMIT_EXCEEDED') }),
    );
    await expect(service.checkAccess(7, 'lab', 1)).resolves.toEqual({
      allowed: false,
      reason: 'org_seat_exceeded',
      planType: 'premium',
    });
  });

  it('allows org members within the seat limit', async () => {
    const deps = makeDeps();
    (deps.repo.findLabPremiumFlag as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (deps.repo.getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (deps.repo.findActiveOrgSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...PAID,
      planType: 'premium',
    });
    (deps.repo.countOrgMembers as ReturnType<typeof vi.fn>).mockResolvedValue(10);
    const service = new EntitlementService(deps);
    await expect(service.assertLabAccess(7, 1)).resolves.toBeUndefined();
  });
});