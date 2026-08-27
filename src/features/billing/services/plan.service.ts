import type { BillingCycle, PlanCatalogDto, PlanTierDto } from '../dto/billing.dto';

/**
 * F9 §08 static plan tier catalog (contract §05 PlanTier interface).
 *
 * Plan metadata never changes at runtime, so the catalog is a frozen
 * constant (no `plans` DB table exists; the contract forbids schema
 * invention). Monthly price is authoritative; the annual price is derived
 * as two months free (10 payments per year).
 */
const PLAN_TIERS: readonly PlanTierDto[] = Object.freeze([
  {
    planType: 'free',
    displayName: 'Free',
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    features: {
      premiumLabsAccess: false,
      premiumCoursesAccess: false,
      labTtlHours: 2,
      labExtensionAllowed: false,
      aiMentorAccess: true,
      certificatesIncluded: false,
      downloadableResources: false,
      prioritySupport: false,
    },
  },
  {
    planType: 'premium',
    displayName: 'DevOps Mentor Premium',
    monthlyPriceUsd: 19,
    annualPriceUsd: 190,
    features: {
      premiumLabsAccess: true,
      premiumCoursesAccess: true,
      labTtlHours: 4,
      labExtensionAllowed: true,
      aiMentorAccess: true,
      certificatesIncluded: true,
      downloadableResources: true,
      prioritySupport: false,
    },
  },
  {
    planType: 'student',
    displayName: 'Student',
    monthlyPriceUsd: 9,
    annualPriceUsd: 90,
    features: {
      premiumLabsAccess: true,
      premiumCoursesAccess: true,
      labTtlHours: 4,
      labExtensionAllowed: true,
      aiMentorAccess: true,
      certificatesIncluded: true,
      downloadableResources: true,
      prioritySupport: false,
    },
  },
  {
    planType: 'enterprise',
    displayName: 'Enterprise',
    monthlyPriceUsd: 99,
    annualPriceUsd: 990,
    features: {
      premiumLabsAccess: true,
      premiumCoursesAccess: true,
      labTtlHours: 8,
      labExtensionAllowed: true,
      aiMentorAccess: true,
      certificatesIncluded: true,
      downloadableResources: true,
      prioritySupport: true,
    },
  },
]);

export interface PlanServiceDeps {
  catalog: readonly PlanTierDto[];
}

function defaultDeps(): PlanServiceDeps {
  return { catalog: PLAN_TIERS };
}

/** BIL-01: static plan catalog endpoint. */
export class PlanService {
  constructor(private readonly deps: PlanServiceDeps = defaultDeps()) {}

  getCatalog(): PlanCatalogDto {
    return { plans: [...this.deps.catalog], currency: 'USD' };
  }

  getTier(planType: PlanTierDto['planType']): PlanTierDto {
    const tier = this.deps.catalog.find((plan) => plan.planType === planType);
    if (!tier) {
      throw new Error(`Unknown plan tier: ${planType}`);
    }
    return tier;
  }

  /** Resolves the pre-discount price for a plan + billing cycle. */
  resolvePrice(planType: PlanTierDto['planType'], billingCycle: BillingCycle): number {
    const tier = this.getTier(planType);
    return billingCycle === 'annual' ? tier.annualPriceUsd : tier.monthlyPriceUsd;
  }

  /** Resolves the per-plan seat allowance from the static feature matrix. */
  getSeatLimit(planType: PlanTierDto['planType']): number {
    switch (planType) {
      case 'enterprise':
        return 100;
      case 'student':
        return 50;
      case 'premium':
        return 10;
      default:
        return 0;
    }
  }
}

export const planService = new PlanService();