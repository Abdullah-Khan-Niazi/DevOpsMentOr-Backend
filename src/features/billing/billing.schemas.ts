import { z } from 'zod';

/**
 * F9 §07 request validation schemas. Every schema strips unknown keys
 * (`strip()`) to prevent mass assignment and HTTP parameter pollution.
 *
 * Absolute security invariant: raw card data (`cardNumber`, `cvv`, `pan`)
 * is rejected with 422 at the schema boundary. Only Stripe tokenized
 * identifiers are ever accepted (AC-07).
 */
const CARD_DATA_FIELDS = ['cardNumber', 'cvv', 'pan', 'card_number', 'card_cvv'] as const;

/**
 * Rejects raw card data by inspecting the RAW request input, because
 * `.strip()` removes unknown keys before a refine on the parsed output
 * could ever see them. The guard runs first, then the parsed schema.
 */
function forbidCardData<S extends z.ZodTypeAny>(schema: S) {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (typeof value !== 'object' || value === null) {
        return;
      }
      const record = value as Record<string, unknown>;
      for (const field of CARD_DATA_FIELDS) {
        if (field in record) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: 'Raw card data is not accepted. Use Stripe tokenization.',
          });
        }
      }
    })
    .pipe(schema);
}

export const PlanTypeSchema = z.enum(['premium', 'enterprise', 'student']);
export const BillingCycleSchema = z.enum(['monthly', 'annual']);

/** BIL-02: POST /api/billing/subscriptions */
export const CreateSubscriptionSchema = forbidCardData(
  z
    .object({
      planType: PlanTypeSchema,
      billingCycle: BillingCycleSchema,
      paymentMethodId: z.number().int().positive().optional(),
      couponCode: z.string().max(50).optional(),
      organizationId: z.number().int().positive().optional(),
    })
    .strip(),
);

/** BIL-05: POST /api/billing/coupons/validate */
export const ValidateCouponSchema = z
  .object({
    code: z.string().min(1).max(50),
    planType: PlanTypeSchema,
    billingCycle: BillingCycleSchema,
  })
  .strip();

/** BIL-07: POST /api/billing/payment-methods */
export const AddPaymentMethodSchema = forbidCardData(
  z
    .object({
      stripePaymentMethodId: z.string().min(1).max(255).optional(),
      methodType: z.enum(['credit_card', 'paypal', 'enterprise_invoice']).default('credit_card'),
      paypalEmail: z.string().email().optional(),
    })
    .strip()
    .superRefine((value, ctx) => {
      if (value.methodType === 'credit_card' && !value.stripePaymentMethodId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stripePaymentMethodId'],
          message: 'stripePaymentMethodId is required for credit_card methods.',
        });
      }
      if (value.methodType === 'paypal' && !value.paypalEmail) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paypalEmail'],
          message: 'paypalEmail is required for paypal methods.',
        });
      }
    }),
);

/** BIL-14: POST /api/billing/portal/session */
export const CreatePortalSessionSchema = z.object({}).strip();

/** BIL-16: PATCH /api/admin/billing/subscriptions/:id */
export const AdjustSubscriptionSchema = z
  .object({
    planType: z.enum(['free', 'premium', 'enterprise', 'student']).optional(),
    autoRenew: z.boolean().optional(),
    isActive: z.boolean().optional(),
    endDate: z.string().datetime().optional(),
  })
  .strip()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

/** BIL-20: POST /api/admin/billing/coupons */
export const CreateCouponSchema = z
  .object({
    code: z.string().min(3).max(50).regex(/^[A-Z0-9_-]+$/),
    description: z.string().max(500).optional(),
    discountType: z.enum(['percentage', 'fixed_amount']),
    discountValue: z.number().positive(),
    maxUses: z.number().int().min(1).default(1),
    expiresAt: z.string().datetime().refine((d) => new Date(d) > new Date(), 'expires_at must be in the future'),
    isActive: z.boolean().default(true),
  })
  .strip()
  .refine((d) => d.discountType !== 'percentage' || d.discountValue <= 100, 'percentage discount must be 0-100');

/** BIL-21: PATCH /api/admin/billing/coupons/:id */
export const UpdateCouponSchema = z
  .object({
    description: z.string().max(500).optional(),
    discountType: z.enum(['percentage', 'fixed_amount']).optional(),
    discountValue: z.number().positive().optional(),
    maxUses: z.number().int().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
    isActive: z.boolean().optional(),
  })
  .strip()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.')
  .refine(
    (d) => d.discountType !== 'percentage' || d.discountValue === undefined || d.discountValue <= 100,
    'percentage discount must be 0-100',
  );

/** Generic pagination query for learner + admin list endpoints. */
export const PaginatedQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

/** Admin search query (BIL-15, BIL-17). */
export const AdminSearchQuerySchema = PaginatedQuerySchema.extend({
  search: z.string().max(255).optional(),
  planType: z.enum(['free', 'premium', 'enterprise', 'student']).optional(),
  status: z.enum(['pending', 'paid', 'failed', 'refunded', 'cancelled']).optional(),
}).strip();

/** Coupon list query (BIL-19). */
export const CouponListQuerySchema = PaginatedQuerySchema.extend({
  search: z.string().max(255).optional(),
}).strip();

/** Route param schemas. */
export const SubscriptionIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();
export const PaymentMethodIdParamSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .strip();
export const OrderIdParamSchema = z.object({ id: z.coerce.number().int().positive() }).strip();
export const InvoiceIdParamSchema = z.object({ id: z.coerce.number().int().positive() }).strip();
export const CouponIdParamSchema = z.object({ id: z.coerce.number().int().positive() }).strip();