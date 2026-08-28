import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { StripeAdapter } from '../adapters/stripe.adapter';
import { runStripeCall, stripeAdapter } from '../adapters/stripe.adapter';
import type { PaymentMethodDto, PaymentMethodType } from '../dto/billing.dto';
import type { BillingRepository, PaymentMethodRow } from '../repositories/billing.repository';
import { billingRepository } from '../repositories/billing.repository';

export interface AddPaymentMethodInput {
  stripePaymentMethodId: string | null;
  methodType: PaymentMethodType;
  paypalEmail: string | null;
}

export interface PaymentMethodServiceDeps {
  repo: Pick<
    BillingRepository,
    | 'listPaymentMethods'
    | 'findOwnedPaymentMethod'
    | 'insertPaymentMethod'
    | 'setDefaultPaymentMethodForUser'
    | 'deactivatePaymentMethod'
    | 'hasActiveAutoRenewSubscription'
    | 'getUserIdentity'
    | 'getOrgId'
  >;
  stripe: Pick<
    StripeAdapter,
    'getOrCreateCustomer' | 'attachPaymentMethod' | 'detachPaymentMethod' | 'getPaymentMethodDetails'
  >;
}

function defaultDeps(): PaymentMethodServiceDeps {
  return { repo: billingRepository, stripe: stripeAdapter };
}

function toDto(row: PaymentMethodRow): PaymentMethodDto {
  return {
    paymentMethodId: row.paymentMethodId,
    methodType: row.methodType,
    last4Digits: row.last4Digits,
    cardBrand: row.cardBrand,
    stripePaymentMethodId: row.stripePaymentMethodId,
    paypalEmail: row.paypalEmail,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * F9 §08 payment method vault. Raw card data never reaches this service:
 * only Stripe tokenized identifiers are accepted and stored (AC-07).
 * Exactly one `is_default` row per user is enforced transactionally
 * (invariant 9); removing the default while an active auto-renewing
 * subscription exists is blocked (invariant 10, AC-08).
 */
export class PaymentMethodService {
  constructor(private readonly deps: PaymentMethodServiceDeps = defaultDeps()) {}

  /** BIL-06: list own active payment methods. */
  async list(userId: number): Promise<PaymentMethodDto[]> {
    const rows = await this.deps.repo.listPaymentMethods(userId);
    return rows.map(toDto);
  }

  /** BIL-07: tokenized payment method add. */
  async add(userId: number, input: AddPaymentMethodInput): Promise<PaymentMethodDto> {
    let stripePaymentMethodId = input.stripePaymentMethodId;
    let last4Digits: string | null = null;
    let cardBrand: string | null = null;

    if (input.methodType === 'credit_card' && stripePaymentMethodId) {
      const identity = await this.deps.repo.getUserIdentity(userId);
      if (!identity) {
        throw new ForbiddenError('User identity could not be resolved.');
      }
      const customer = await runStripeCall('getOrCreateCustomer', () =>
        this.deps.stripe.getOrCreateCustomer({
          userId,
          email: identity.email,
          fullName: identity.fullName,
        }),
      );
      await runStripeCall('attachPaymentMethod', () =>
        this.deps.stripe.attachPaymentMethod(stripePaymentMethodId, customer.id),
      );
      const details = await runStripeCall('getPaymentMethodDetails', () =>
        this.deps.stripe.getPaymentMethodDetails(stripePaymentMethodId),
      );
      last4Digits = details.last4;
      cardBrand = details.brand;
    }

    const existing = await this.deps.repo.listPaymentMethods(userId);
    const paymentMethodId = await this.deps.repo.insertPaymentMethod({
      userId,
      methodType: input.methodType,
      last4Digits,
      cardBrand,
      stripePaymentMethodId,
      paypalEmail: input.paypalEmail,
    });

    if (existing.length === 0) {
      await this.deps.repo.setDefaultPaymentMethodForUser(paymentMethodId, userId);
    }

    const row = await this.deps.repo.findOwnedPaymentMethod(paymentMethodId, userId);
    if (!row) {
      throw new NotFoundError('Payment method could not be loaded.');
    }
    return toDto(row);
  }

  /** BIL-08: set the default method (transactional single-default rule). */
  async setDefault(paymentMethodId: number, userId: number): Promise<PaymentMethodDto> {
    const method = await this.deps.repo.findOwnedPaymentMethod(paymentMethodId, userId);
    if (!method || !method.isActive) {
      throw new NotFoundError('Payment method not found.');
    }
    await this.deps.repo.setDefaultPaymentMethodForUser(paymentMethodId, userId);
    const row = await this.deps.repo.findOwnedPaymentMethod(paymentMethodId, userId);
    if (!row) {
      throw new NotFoundError('Payment method could not be loaded.');
    }
    return toDto(row);
  }

  /** BIL-09: remove a payment method (Stripe detach + `is_active = false`). */
  async remove(paymentMethodId: number, userId: number): Promise<void> {
    const method = await this.deps.repo.findOwnedPaymentMethod(paymentMethodId, userId);
    if (!method || !method.isActive) {
      throw new NotFoundError('Payment method not found.');
    }

    if (method.isDefault) {
      const hasActiveAutoRenew = await this.deps.repo.hasActiveAutoRenewSubscription(userId);
      if (hasActiveAutoRenew) {
        throw new ConflictError(
          'DEFAULT_PAYMENT_METHOD_IN_USE: Set another default payment method before removing this one.',
        );
      }
    }

    if (method.stripePaymentMethodId) {
      const stripePaymentMethodId = method.stripePaymentMethodId;
      await runStripeCall('detachPaymentMethod', () =>
        this.deps.stripe.detachPaymentMethod(stripePaymentMethodId),
      );
    }

    await this.deps.repo.deactivatePaymentMethod(paymentMethodId);
  }
}

export const paymentMethodService = new PaymentMethodService();