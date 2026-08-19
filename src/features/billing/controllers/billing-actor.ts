import type { Request } from 'express';
import type { BillingActor } from '../dto/billing.dto';

export function actorFrom(req: Request): BillingActor {
  return {
    userId: Number(req.user?.sub),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export const userIdFrom = (req: Request): number => Number(req.user?.sub);