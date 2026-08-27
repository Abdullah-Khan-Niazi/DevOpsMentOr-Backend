import type { LearningActivityType, ActivityLogDto } from '../dto/progress.dto';
import type { ProgressRepository } from '../repositories/progress.repository';
import { progressRepository } from '../repositories/progress.repository';

export interface ActivityLogServiceDeps {
  repo: Pick<ProgressRepository, 'recordActivity' | 'listActivity'>;
}

function defaultDeps(): ActivityLogServiceDeps {
  return { repo: progressRepository };
}

/**
 * F5 §02 forward hook: writes learner event records to `activity_logs`.
 * Called by ProgressService (LESSON_STARTED, LESSON_COMPLETED, MODULE_*,
 * QUIZ_*) and by F6 via the exported `recordEvent` hook when lab states
 * change (LAB_STARTED, LAB_COMPLETED, LAB_FAILED).
 */
export class ActivityLogService {
  constructor(private readonly deps: ActivityLogServiceDeps = defaultDeps()) {}

  /** Public hook consumed by F5 services and F6 lab engine. */
  async recordEvent(
    userId: number,
    eventType: LearningActivityType,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.repo.recordActivity(userId, eventType, details ?? null);
  }

  /** F5-API-06: recent activity for the learner dashboard feed. */
  async getActivityHistory(userId: number, limit: number): Promise<ActivityLogDto[]> {
    const rows = await this.deps.repo.listActivity(userId, limit);
    return rows.map((row) => ({
      logId: row.logId,
      activityType: row.activityType as LearningActivityType,
      details: row.details,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

export const activityLogService = new ActivityLogService();
