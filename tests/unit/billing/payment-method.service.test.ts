import { describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../../src/shared/errors';
import {
  PaymentMethodService,
  type PaymentMethodServiceDeps,
} from '../../../src/features/billing/services/payment-method.service';
import type { PaymentMethodRow } from '../../../src/features/billing/repositories/billing.repository';

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const CARD_ROW: PaymentMethodRow = {
  paymentMethodId: 1,
  userId: 7,
  methodType: 'credit_card',
  last4Digits: '4242',
  cardBrand: 'visa',
  stripePaymentMethodId: 'pm_1',
  paypalEmail: null,
  isDefault: true,
  isActive: true,
  createdAt: new Date(),
};

function makeDeps(overrides: Partial<Mocked<PaymentMethodServiceDeps>> = {}): Mocked<PaymentMethodServiceDeps> {
  return {
    repo: {
      listPaymentMethods: vi.fn(async () => []),
      findOwnedPaymentMethod: vi.fn(async () => null),
      insertPaymentMethod: vi.fn(async () => 1),
      setDefaultPaymentMethodForUser: vi.fn(async () => undefined),
      deactivatePaymentMethod: vi.fn(async () => undefined),
      hasActiveAutoRenewSubscription: vi.fn(async () => false),
      getUserIdentity: vi.fn(async () => ({ email: 'a@b.c', fullName: 'A' })),
      getOrgId: vi.fn(async () => null),
    },
    stripe: {
      getOrCreateCustomer: vi.fn(async () => ({ id: 'cus_1' })),
      attachPaymentMethod: vi.fn(async () => undefined),
      detachPaymentMethod: vi.fn(async () => undefined),
      getPaymentMethodDetails: vi.fn(async () => ({ brand: 'visa', last4: '4242' })),
    },
    ...overrides,
  };
}

const addInput = {
  stripePaymentMethodId: 'pm_1',
  methodType: 'credit_card' as const,
  paypalEmail: null,
};

describe('F9 PaymentMethodService (BIL-06..09, invariants 9-10)', () => {
  it('promotes the first payment method to default automatically', async () => {
    const deps = makeDeps();
    (deps.repo.listPaymentMethods as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (deps.repo.findOwnedPaymentMethod as ReturnType<typeof vi.fn>).mockResolvedValue(CARD_ROW);
    const service = new PaymentMethodService(deps);
    const method = await service.add(7, addInput);
    expect(deps.stripe.attachPaymentMethod).toHaveBeenCalledWith('pm_1', 'cus_1');
    expect(deps.repo.setDefaultPaymentMethodForUser).toHaveBeenCalledWith(1, 7);
    expect(method.cardBrand).toBe('visa');
    expect(method.last4Digits).toBe('4242');
  });

  it('does not force a default when the user already has methods', async () => {
    const deps = makeDeps();
    (deps.repo.listPaymentMethods as ReturnType<typeof vi.fn>).mockResolvedValue([CARD_ROW]);
    (deps.repo.findOwnedPaymentMethod as ReturnType<typeof vi.fn>).mockResolvedValue(CARD_ROW);
    const service = new PaymentMethodService(deps);
    await service.add(7, addInput);
    expect(deps.repo.setDefaultPaymentMethodForUser).not.toHaveBeenCalled();
  });

  it('sets a default only for owned methods', async () => {
    const deps = makeDeps();
    const service = new PaymentMethodService(deps);
    await expect(service.setDefault(99, 7)).rejects.toThrow(NotFoundError);
  });

  it('blocks removing the default while an active auto-renewing subscription exists (409)', async () => {
    const deps = makeDeps();
    (deps.repo.findOwnedPaymentMethod as ReturnType<typeof vi.fn>).mockResolvedValue(CARD_ROW);
    (deps.repo.hasActiveAutoRenewSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const service = new PaymentMethodService(deps);
    await expect(service.remove(1, 7)).rejects.toThrow(
      expect.objectContaining({ message: expect.stringContaining('DEFAULT_PAYMENT_METHOD_IN_USE') }),
    );
    await expect(service.remove(1, 7)).rejects.toBeInstanceOf(ConflictError);
    expect(deps.stripe.detachPaymentMethod).not.toHaveBeenCalled();
  });

  it('detaches from Stripe and deactivates the row otherwise', async () => {
    const deps = makeDeps();
    (deps.repo.findOwnedPaymentMethod as ReturnType<typeof vi.fn>).mockResolvedValue(CARD_ROW);
    const service = new PaymentMethodService(deps);
    await service.remove(1, 7);
    expect(deps.stripe.detachPaymentMethod).toHaveBeenCalledWith('pm_1');
    expect(deps.repo.deactivatePaymentMethod).toHaveBeenCalledWith(1);
  });
});