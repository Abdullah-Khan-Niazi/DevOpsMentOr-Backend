import { planService } from '../../billing/services/plan.service';
import { entitlementService as billingEntitlementService } from '../../billing/services/entitlement.service';
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
 * F6 §02 F9 gate seam.
 *
 * F9 (Subscription/Billing/Entitlements) is the canonical owner of all
 * entitlement logic; this seam delegates plan resolution, premium-lab
 * gating and TTL to the billing entitlement service while preserving the
 * F6-facing API so LabService and existing tests keep working (F6 §12).
 */
export class EntitlementService {
  constructor(private readonly deps: EntitlementServiceDeps = defaultDeps()) {}

  /** Active plan tier for the user (F9-owned resolution, default `free`). */
  async getPlanTier(userId: number): Promise<PlanTier> {
    return billingEntitlementService.getUserPlanType(userId);
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
    await billingEntitlementService.assertLabAccess(userId, labId);
  }

  /**
   * F9-derived instance TTL in hours: free 2, student/premium 4,
   * enterprise 8 (F6 §05 invariant 3).
   */
  async getLabTtlHours(userId: number): Promise<number> {
    const tier = await this.getPlanTier(userId);
    return planService.getTier(tier).features.labTtlHours;
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