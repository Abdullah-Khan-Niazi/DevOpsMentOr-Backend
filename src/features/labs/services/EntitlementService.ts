import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '../../../app/database';
import { subscriptions } from '../../../app/database/schema';
import { ForbiddenError } from '../../../shared/errors';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

export type PlanTier = 'free' | 'student' | 'premium' | 'enterprise';

export interface EntitlementServiceDeps {
  repo: Pick<LabsRepository, 'findLabById'>;
}

function defaultDeps(): EntitlementServiceDeps {
  return { repo: labsRepository };
}

/**
 * F6 §02 F9 runtime gate seam.
 *
 * F9 (Subscription/Billing/Entitlements) owns all entitlement logic in its
 * wave; until then this seam resolves the learner's active subscription plan
 * from `subscriptions` (read-only, never written) and derives the premium-lab
 * gate and instance TTL. The tier defaults below are F9-owned values that F9
 * will supersede; F6 does not decide them (F6 §12).
 */
export class EntitlementService {
  constructor(private readonly deps: EntitlementServiceDeps = defaultDeps()) {}

  /** Active subscription tier for the user, defaulting to `free`. */
  async getPlanTier(userId: number): Promise<PlanTier> {
    const rows = await db
      .select({ planType: subscriptions.planType })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.isActive, true),
          or(
            isNull(subscriptions.endDate),
            gt(subscriptions.endDate, new Date()),
          ),
        ),
      )
      .orderBy(desc(subscriptions.startDate))
      .limit(1);
    const tier = rows[0]?.planType ?? 'free';
    return tier;
  }

  /** F9 gate: throws 403 when the learner's plan does not include the lab. */
  async assertLabAccess(userId: number, labId: number): Promise<void> {
    const lab = await this.deps.repo.findLabById(labId);
    if (!lab) {
      return;
    }
    if (!lab.isPremium) {
      return;
    }
    const tier = await this.getPlanTier(userId);
    if (tier === 'free') {
      throw new ForbiddenError(
        'This lab requires a premium subscription. Upgrade your plan to launch it.',
      );
    }
  }

  /**
   * F9-derived instance TTL in hours: free 2, student/premium 4,
   * enterprise 8 (F6 §05 invariant 3).
   */
  async getLabTtlHours(userId: number): Promise<number> {
    const tier = await this.getPlanTier(userId);
    switch (tier) {
      case 'enterprise':
        return 8;
      case 'premium':
      case 'student':
        return 4;
      default:
        return 2;
    }
  }

  /** F9-derived per-instance extension allowance (F6 §03 journey 5). */
  async getExtensionLimit(userId: number): Promise<number> {
    const tier = await this.getPlanTier(userId);
    switch (tier) {
      case 'enterprise':
        return 10;
      case 'premium':
      case 'student':
        return 3;
      default:
        return 1;
    }
  }
}

export const entitlementService = new EntitlementService();