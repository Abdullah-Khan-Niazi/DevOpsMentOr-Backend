import { ConflictError, NotFoundError } from '../../../shared/errors';
import { AUDIT_ACTIONS } from '../../../shared/constants';
import { auditLogService } from '../../admin/services/audit-log.service';
import type { BillingActor, CouponDto, DiscountType } from '../dto/billing.dto';
import type { BillingRepository, CouponRow } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';

export interface CreateCouponInput {
  code: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  maxUses: number;
  expiresAt: string;
}

export interface UpdateCouponInput {
  description?: string | null;
  discountType?: DiscountType;
  discountValue?: number;
  maxUses?: number;
  expiresAt?: string;
  isActive?: boolean;
}

export interface AdminCouponServiceDeps {
  repo: Pick<
    BillingRepository,
    | 'listCouponsForAdmin'
    | 'findCouponByCode'
    | 'findCouponById'
    | 'insertCoupon'
    | 'updateCoupon'
  >;
  audit: typeof auditLogService;
}

function defaultDeps(): AdminCouponServiceDeps {
  return { repo: billingRepository, audit: auditLogService };
}

function toDto(row: CouponRow): CouponDto {
  return {
    couponId: row.couponId,
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    discountValue: toNumber(row.discountValue),
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt.toISOString(),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseFloat(value);
}

/**
 * F9 §08 coupon management (BIL-19..21). Codes are normalized to uppercase
 * (invariant 8) and validated against the coupon table (invariant 9).
 * Every mutation records an audit row (F2 invariant 8).
 */
export class AdminCouponService {
  constructor(private readonly deps: AdminCouponServiceDeps = defaultDeps()) {}

  /** BIL-20: paginated coupon list with code search. */
  async list(
    page: number,
    limit: number,
    search: string | undefined,
  ): Promise<{ items: CouponDto[]; total: number; page: number; limit: number }> {
    const { rows, total } = await this.deps.repo.listCouponsForAdmin(page, limit, search);
    return { items: rows.map(toDto), total, page, limit };
  }

  /** BIL-19: create a coupon; duplicate codes are rejected (409). */
  async create(
    actor: BillingActor,
    input: CreateCouponInput,
  ): Promise<CouponDto> {
    const code = input.code.toUpperCase();
    const existing = await this.deps.repo.findCouponByCode(code);
    if (existing) {
      throw new ConflictError('COUPON_CODE_EXISTS: A coupon with this code already exists.');
    }

    const couponId = await this.deps.repo.insertCoupon({
      code,
      description: input.description,
      discountType: input.discountType,
      discountValue: input.discountValue.toFixed(2),
      maxUses: input.maxUses,
      expiresAt: new Date(input.expiresAt),
      isActive: true,
    });
    await this.deps.audit.record({
      adminUserId: actor.userId,
      action: AUDIT_ACTIONS.CREATE_COUPON,
      targetType: 'coupon',
      targetId: couponId,
      changes: { code, discountType: input.discountType, discountValue: input.discountValue, maxUses: input.maxUses },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const row = await this.deps.repo.findCouponById(couponId);
    if (!row) {
      throw new NotFoundError('Coupon could not be loaded.');
    }
    return toDto(row);
  }

  /** BIL-21: update a coupon with audit trail. */
  async update(
    couponId: number,
    actor: BillingActor,
    input: UpdateCouponInput,
  ): Promise<CouponDto> {
    const existing = await this.deps.repo.findCouponById(couponId);
    if (!existing) {
      throw new NotFoundError('Coupon not found.');
    }

    const changes: Record<string, unknown> = {};
    const fields: Parameters<BillingRepository['updateCoupon']>[1] = {};
    if (input.description !== undefined && input.description !== existing.description) {
      fields.description = input.description;
      changes.description = { from: existing.description, to: input.description };
    }
    if (input.discountType !== undefined && input.discountType !== existing.discountType) {
      fields.discountType = input.discountType;
      changes.discountType = { from: existing.discountType, to: input.discountType };
    }
    if (input.discountValue !== undefined && input.discountValue !== toNumber(existing.discountValue)) {
      fields.discountValue = input.discountValue.toFixed(2);
      changes.discountValue = { from: toNumber(existing.discountValue), to: input.discountValue };
    }
    if (input.maxUses !== undefined && input.maxUses !== existing.maxUses) {
      fields.maxUses = input.maxUses;
      changes.maxUses = { from: existing.maxUses, to: input.maxUses };
    }
    if (input.expiresAt !== undefined) {
      fields.expiresAt = new Date(input.expiresAt);
      changes.expiresAt = { from: existing.expiresAt.toISOString(), to: new Date(input.expiresAt).toISOString() };
    }
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      fields.isActive = input.isActive;
      changes.isActive = { from: existing.isActive, to: input.isActive };
    }

    if (Object.keys(fields).length > 0) {
      await this.deps.repo.updateCoupon(couponId, fields);
      await this.deps.audit.record({
        adminUserId: actor.userId,
        action: AUDIT_ACTIONS.UPDATE_COUPON,
        targetType: 'coupon',
        targetId: couponId,
        changes,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    }

    const row = await this.deps.repo.findCouponById(couponId);
    if (!row) {
      throw new NotFoundError('Coupon could not be loaded.');
    }
    return toDto(row);
  }
}

export const adminCouponService = new AdminCouponService();