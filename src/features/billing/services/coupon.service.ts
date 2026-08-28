import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { BillingCycle, CouponValidationDto, PlanType } from '../dto/billing.dto';
import type { BillingRepository, CouponRow } from '../repositories/billing.repository';
import { billingRepository, toNumber } from '../repositories/billing.repository';
import { planService } from './plan.service';

export interface CouponServiceDeps {
  repo: Pick<
    BillingRepository,
    'findCouponByCode' | 'incrementCouponUsage'
  >;
  priceResolver: (planType: PlanType, billingCycle: BillingCycle) => number;
}

function defaultDeps(): CouponServiceDeps {
  return { repo: billingRepository, priceResolver: (planType, cycle) => planService.resolvePrice(planType, cycle) };
}

/**
 * F9 §08 discount engine (contract §05 invariants 3-5).
 *
 * - Coupon validation is case-insensitive: codes are stored uppercase and
 *   compared uppercased (invariant 4).
 * - `percentage` discount: `FLOOR(total × value / 100)` (rounds down to the
 *   cent). `fixed_amount`: `MIN(value, total)`. `final` is never negative.
 * - `used_count` increments atomically with a guarded UPDATE (AC-03); when
 *   the limit is hit between validation and application the checkout
 *   returns 409 `COUPON_MAX_USES_REACHED`.
 */
export class CouponService {
  constructor(private readonly deps: CouponServiceDeps = defaultDeps()) {}

  private requireUsable(coupon: CouponRow): void {
    if (!coupon.isActive || coupon.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundError('This coupon is invalid or has expired.');
    }
    if (coupon.usedCount >= coupon.maxUses) {
      throw new ConflictError('COUPON_MAX_USES_REACHED: This coupon has reached its usage limit.');
    }
  }

  /** BIL-05: validate a coupon code and return the discounted preview. */
  async validate(code: string, planType: PlanType, billingCycle: BillingCycle): Promise<CouponValidationDto> {
    const coupon = await this.deps.repo.findCouponByCode(code.trim().toUpperCase());
    if (!coupon) {
      throw new NotFoundError('This coupon does not exist.');
    }
    this.requireUsable(coupon);

    const originalPrice = this.deps.priceResolver(planType, billingCycle);
    const { discountAmount, finalPrice } = this.computeDiscount(
      coupon.discountType,
      toNumber(coupon.discountValue),
      originalPrice,
    );

    return {
      couponId: coupon.couponId,
      discountType: coupon.discountType,
      discountValue: toNumber(coupon.discountValue),
      originalPrice,
      discountAmount,
      finalPrice,
      expiresAt: coupon.expiresAt.toISOString(),
    };
  }

  /** Invariant 5 discount formulas; `final` is always >= 0 (AC-04). */
  computeDiscount(
    discountType: CouponRow['discountType'],
    discountValue: number,
    totalAmount: number,
  ): { discountAmount: number; finalPrice: number } {
    const discountAmount =
      discountType === 'percentage'
        ? Math.floor(totalAmount * (discountValue / 100) * 100) / 100
        : Math.min(discountValue, totalAmount);
    const finalPrice = Math.max(0, totalAmount - discountAmount);
    return { discountAmount, finalPrice };
  }

  /**
   * Applies a coupon at checkout: atomically increments usage and returns
   * the resolved discount. Throws 409 when the coupon exhausted between
   * validation and application (invariant 3).
   */
  async apply(code: string, totalAmount: number): Promise<{ discountAmount: number; couponId: number }> {
    const coupon = await this.deps.repo.findCouponByCode(code.trim().toUpperCase());
    if (!coupon) {
      throw new NotFoundError('This coupon does not exist.');
    }
    this.requireUsable(coupon);
    const applied = await this.deps.repo.incrementCouponUsage(coupon.couponId);
    if (!applied) {
      throw new ConflictError('COUPON_MAX_USES_REACHED: This coupon has reached its usage limit.');
    }
    const { discountAmount } = this.computeDiscount(
      coupon.discountType,
      toNumber(coupon.discountValue),
      totalAmount,
    );
    return { discountAmount, couponId: coupon.couponId };
  }
}

export const couponService = new CouponService();