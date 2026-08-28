import { env } from '../../../app/config';
import { logger } from '../../../shared/logger';
import { notificationService } from '../../notifications';
import type { BillingRepository } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';

export interface SubscriptionExpiryJobDeps {
  repo: Pick<BillingRepository, 'listExpiredNonRenewing' | 'markSubscriptionInactive'>;
  notify: Pick<typeof notificationService, 'dispatch'>;
  intervalHours: number;
}

function defaultDeps(): SubscriptionExpiryJobDeps {
  return {
    repo: billingRepository,
    notify: notificationService,
    intervalHours: env.SUBSCRIPTION_EXPIRY_CHECK_INTERVAL_HOURS,
  };
}

/**
 * F9 §08 AC-14: every `SUBSCRIPTION_EXPIRY_CHECK_INTERVAL_HOURS` the job
 * marks expired non-auto-renewing subscriptions inactive and notifies the
 * user, so the entitlement gate (`is_active` + `end_date`) is always the
 * source of truth without Stripe round-trips. Failures are logged; the job
 * never crashes the process.
 */
export class SubscriptionExpiryJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: SubscriptionExpiryJobDeps = defaultDeps()) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.run().catch((error) => {
        logger.error({ err: error }, 'Subscription expiry job run failed');
      });
    }, this.deps.intervalHours * 60 * 60 * 1000);
    this.timer.unref();
    logger.info(`Subscription expiry job started (interval: ${this.deps.intervalHours}h)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep; exposed for tests. */
  async run(): Promise<number> {
    const now = new Date();
    const expired = await this.deps.repo.listExpiredNonRenewing(now);
    for (const subscription of expired) {
      await this.deps.repo.markSubscriptionInactive(subscription.subscriptionId);
      await this.deps.notify.dispatch({
        userId: subscription.userId,
        type: 'system',
        title: 'Subscription expired',
        message: 'Your subscription has ended. Renew to keep premium access.',
      });
    }
    if (expired.length > 0) {
      logger.info(`Subscription expiry job deactivated ${expired.length} subscription(s)`);
    }
    return expired.length;
  }
}

export const subscriptionExpiryJob = new SubscriptionExpiryJob();