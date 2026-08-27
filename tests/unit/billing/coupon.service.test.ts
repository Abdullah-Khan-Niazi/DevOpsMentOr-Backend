import { describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../../src/shared/errors';
import { CouponService, type CouponServiceDeps } from '../../../src/features/billing/services/coupon.service';
import type { CouponRow } from '../../../src/features/billing/repositories/billing.repository';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

function makeCoupon(overrides: Partial<CouponRow> = {}): CouponRow {
  return {
    couponId: 1,
    code: 'SAVE20',
    description: null,
    discountType: 'percentage',
    discountValue: '20.00',
    maxUses: 5,
    usedCount: 0,
    expiresAt: new Date(Date.now() + 86_400_000),
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Mocked<CouponServiceDeps>> = {}): Mocked<CouponServiceDeps> {
  return {
    repo: {
      findCouponByCode: vi.fn(async () => null),
      incrementCouponUsage: vi.fn(async () => true),
    },
    priceResolver: vi.fn(async (planType, billingCycle) =>
      billingCycle === 'annual' ? 190 : 19,
    ),
    ...overrides,
  };
}

describe('F9 CouponService (BIL-05, invariants 3-5)', () => {
  it('normalizes codes to uppercase for lookup', async () => {
    const deps = makeDeps();
    (deps.repo.findCouponByCode as ReturnType<typeof vi.fn>).mockResolvedValue(makeCoupon());
    const service = new CouponService(deps);
    await service.validate('  save20 ', 'premium', 'monthly');
    expect(deps.repo.findCouponByCode).toHaveBeenCalledWith('SAVE20');
  });

  it('rejects unknown coupons with 404', async () => {
    const service = new CouponService(makeDeps());
    await expect(service.validate('NOPE', 'premium', 'monthly')).rejects.toThrow(NotFoundError);
  });

  it('rejects expired coupons with 404', async () => {
    const deps = makeDeps();
    (deps.repo.findCouponByCode as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCoupon({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const service = new CouponService(deps);
    await expect(service.validate('SAVE20', 'premium', 'monthly')).rejects.toThrow(NotFoundError);
  });

  it('rejects exhausted coupons with 409 COUPON_MAX_USES_REACHED', async () => {
    const deps = makeDeps();
    (deps.repo.findCouponByCode as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCoupon({ maxUses: 5, usedCount: 5 }),
    );
    const service = new CouponService(deps);
    await expect(service.validate('SAVE20', 'premium', 'monthly')).rejects.toThrow(
      expect.objectContaining({ message: expect.stringContaining('COUPON_MAX_USES_REACHED') }),
    );
    await expect(service.validate('SAVE20', 'premium', 'monthly')).rejects.toBeInstanceOf(ConflictError);
  });

  it('applies percentage discounts with floor-to-cent rounding', () => {
    const service = new CouponService(makeDeps());
    const result = service.computeDiscount('percentage', 20, 19);
    expect(result.discountAmount).toBe(3.8);
    expect(result.finalPrice).toBe(15.2);
  });

  it('caps fixed-amount discounts at the order total (final never negative)', () => {
    const service = new CouponService(makeDeps());
    const result = service.computeDiscount('fixed_amount', 500, 19);
    expect(result.discountAmount).toBe(19);
    expect(result.finalPrice).toBe(0);
  });

  it('atomically increments usage on apply and returns the discount', async () => {
    const deps = makeDeps();
    (deps.repo.findCouponByCode as ReturnType<typeof vi.fn>).mockResolvedValue(makeCoupon());
    const service = new CouponService(deps);
    const result = await service.apply('save20', 190);
    expect(deps.repo.incrementCouponUsage).toHaveBeenCalledWith(1);
    expect(result).toEqual({ discountAmount: 38, couponId: 1 });
  });

  it('returns 409 when the coupon exhausts between validation and apply', async () => {
    const deps = makeDeps();
    (deps.repo.findCouponByCode as ReturnType<typeof vi.fn>).mockResolvedValue(makeCoupon());
    (deps.repo.incrementCouponUsage as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const service = new CouponService(deps);
    await expect(service.apply('SAVE20', 190)).rejects.toThrow(
      expect.objectContaining({ message: expect.stringContaining('COUPON_MAX_USES_REACHED') }),
    );
  });
});