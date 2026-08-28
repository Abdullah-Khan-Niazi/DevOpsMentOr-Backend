import { ForbiddenError } from '../../../shared/errors';
import type { EntitlementResult, PlanType } from '../dto/billing.dto';
import type { BillingRepository } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';
import { planService } from './plan.service';

export interface EntitlementServiceDeps {
  repo: Pick<
    BillingRepository,
    | 'findActiveByUser'
    | 'findActiveOrgSubscription'
    | 'getOrgId'
    | 'countOrgMembers'
    | 'getPlanSeatLimit'
    | 'findLabPremiumFlag'
    | 'findCoursePremiumFlag'
  >;
  seatFallback: (planType: PlanType) => number;
}

function defaultDeps(): EntitlementServiceDeps {
  return { repo: billingRepository, seatFallback: (planType) => planService.getSeatLimit(planType) };
}

const PLAN_INSUFFICIENT_MESSAGE =
  'This content requires a paid subscription. Upgrade your plan to access it.';

/**
 * F9 §02 entitlement gate, exported for F5 (`assertCourseAccess`) and F6
 * (`assertLabAccess`). The plan tier is resolved exclusively from the
 * `subscriptions` table derived from `userId`; no client-supplied plan or
 * role value is ever trusted. A user with no active subscription row is on
 * the free plan (AC-01).
 *
 * Org model: a user affiliated with an organization (via `user_settings
 * org_id`, F3) whose organization holds an active subscription is entitled
 * through the org plan. Seat enforcement validates `active org member
 * count <= plan seats` before granting access (invariant 11).
 */
export class EntitlementService {
  constructor(private readonly deps: EntitlementServiceDeps = defaultDeps()) {}

  /** Current plan tier for a user; `free` when no active subscription (AC-13). */
  async getUserPlanType(userId: number): Promise<PlanType> {
    const individual = await this.deps.repo.findActiveByUser(userId);
    if (individual) {
      return individual.planType;
    }
    const orgId = await this.deps.repo.getOrgId(userId);
    if (orgId !== null) {
      const orgSub = await this.deps.repo.findActiveOrgSubscription(orgId);
      if (orgSub) {
        return orgSub.planType;
      }
    }
    return 'free';
  }

  /**
   * F9 gate consumed by F6 `LabService.provisionInstance`: throws 403 when
   * the learner's plan does not include the (premium) lab.
   */
  async assertLabAccess(userId: number, labId: number): Promise<void> {
    const isPremium = await this.deps.repo.findLabPremiumFlag(labId);
    if (isPremium === null || !isPremium) {
      return;
    }
    await this.assertEntitled(userId);
  }

  /**
   * F9 gate consumed by F5 `ProgressService` before writing progress on
   * premium course content: throws 403 when the plan is insufficient.
   */
  async assertCourseAccess(userId: number, courseId: number): Promise<void> {
    const isPremium = await this.deps.repo.findCoursePremiumFlag(courseId);
    if (isPremium === null || !isPremium) {
      return;
    }
    await this.assertEntitled(userId);
  }

  /** Structured gate result (contract §02) without throwing. */
  async checkAccess(
    userId: number,
    target: 'lab' | 'course',
    targetId: number,
  ): Promise<EntitlementResult> {
    const isPremium =
      target === 'lab'
        ? await this.deps.repo.findLabPremiumFlag(targetId)
        : await this.deps.repo.findCoursePremiumFlag(targetId);
    if (!isPremium) {
      return { allowed: true, reason: 'free_content', planType: null };
    }
    const planType = await this.getUserPlanType(userId);
    if (planType === 'free') {
      return { allowed: false, reason: 'no_subscription', planType: 'free' };
    }
    if (await this.orgSeatExceeded(userId)) {
      return { allowed: false, reason: 'org_seat_exceeded', planType };
    }
    return { allowed: true, reason: 'active_subscription', planType };
  }

  private async assertEntitled(userId: number): Promise<void> {
    const planType = await this.getUserPlanType(userId);
    if (planType === 'free') {
      throw new ForbiddenError(PLAN_INSUFFICIENT_MESSAGE);
    }
    if (await this.orgSeatExceeded(userId)) {
      throw new ForbiddenError('ORG_SEAT_LIMIT_EXCEEDED: Your organization has reached its seat limit.');
    }
  }

  /** Org seat enforcement (invariant 11): org plan users count against seats. */
  private async orgSeatExceeded(userId: number): Promise<boolean> {
    const orgId = await this.deps.repo.getOrgId(userId);
    if (orgId === null) {
      return false;
    }
    const orgSub = await this.deps.repo.findActiveOrgSubscription(orgId);
    if (!orgSub) {
      return false;
    }
    const seatLimit =
      (await this.deps.repo.getPlanSeatLimit(orgSub.planType)) ?? this.deps.seatFallback(orgSub.planType);
    const members = await this.deps.repo.countOrgMembers(orgId);
    return members > seatLimit;
  }
}

export const entitlementService = new EntitlementService();