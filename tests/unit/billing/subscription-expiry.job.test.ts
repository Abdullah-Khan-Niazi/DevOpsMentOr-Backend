import { describe, expect, it, vi } from 'vitest';
import {
  SubscriptionExpiryJob,
  type SubscriptionExpiryJobDeps,
} from '../../../src/features/billing/jobs/subscription-expiry.job';
import type { SubscriptionRow } from '../../../src/features/billing/repositories/billing.repository';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const EXPIRED_ROW: SubscriptionRow = {
  subscriptionId: 3,
  userId: 7,
  organizationId: null,
  planName: 'Student',
  planType: 'student',
  stripeSubscriptionId: 'sub_3',
  startDate: new Date('2025-01-01T00:00:00.000Z'),
  endDate: new Date('2025-02-01T00:00:00.000Z'),
  autoRenew: false,
  isActive: true,
  cancelledAt: null,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
};

function makeDeps(overrides: Partial<Mocked<SubscriptionExpiryJobDeps>> = {}): Mocked<SubscriptionExpiryJobDeps> {
  return {
    repo: {
      listExpiredNonRenewing: vi.fn(async () => [EXPIRED_ROW]),
      markSubscriptionInactive: vi.fn(async () => undefined),
    },
    notify: {
      dispatch: vi.fn(async () => ({ inApp: true, email: false })),
    },
    intervalHours: 24,
    ...overrides,
  };
}

describe('F9 SubscriptionExpiryJob (AC-14)', () => {
  it('deactivates expired non-renewing subscriptions and notifies the user', async () => {
    const deps = makeDeps();
    const job = new SubscriptionExpiryJob(deps);
    const count = await job.run();
    expect(count).toBe(1);
    expect(deps.repo.markSubscriptionInactive).toHaveBeenCalledWith(3);
    expect(deps.notify.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, type: 'system', title: 'Subscription expired' }),
    );
  });

  it('does nothing when no subscriptions are expired', async () => {
    const deps = makeDeps();
    (deps.repo.listExpiredNonRenewing as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const job = new SubscriptionExpiryJob(deps);
    await expect(job.run()).resolves.toBe(0);
    expect(deps.repo.markSubscriptionInactive).not.toHaveBeenCalled();
    expect(deps.notify.dispatch).not.toHaveBeenCalled();
  });
});