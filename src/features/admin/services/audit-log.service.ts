import { db } from '../../../app/database';
import { auditLogs } from '../../../app/database/schema';

export interface AuditEntryInput {
  adminUserId: number;
  action: string;
  targetType: string | null;
  targetId: number | null;
  changes: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Single writer for `audit_logs` (F2 §05 invariant 8). Every platform admin
 * mutation (ban, unban, soft-delete, settings change) records a row with the
 * acting admin, action string, target and before/after `changes` JSON.
 */
export class AuditLogService {
  async record(input: AuditEntryInput): Promise<void> {
    await db.insert(auditLogs).values({
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      changes: input.changes,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }
}

export const auditLogService = new AuditLogService();