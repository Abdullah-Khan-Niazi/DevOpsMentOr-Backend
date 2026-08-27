import { ConflictError, NotFoundError } from '../../../shared/errors';
import { activityLogService } from '../../progress/services/ActivityLogService';
import type { LabCompletionEvent, SherlockSubmissionResultDto } from '../dto/labs.dto';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

export interface SherlockServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'findSherlockByLabId'
    | 'findProLabByLabId'
    | 'hasLabCompletionEvent'
    | 'findLabStartTime'
    | 'findAnyActiveInstanceForUser'
  >;
}

function defaultDeps(): SherlockServiceDeps {
  return { repo: labsRepository };
}

function normalize(answer: string): string {
  return answer.trim().toLowerCase();
}

/**
 * F6 §06 Sherlock forensics: answers are validated server-side against
 * `sherlocks.answers` (an array of objects with `id` + `answer`).
 * Answers are never returned in any payload (invariant 4). Full pass writes
 * the LAB_COMPLETED activity event with a computed time-taken.
 */
export class SherlockService {
  constructor(private readonly deps: SherlockServiceDeps = defaultDeps()) {}

  async submitAnswers(
    userId: number,
    labId: number,
    answers: Array<{ questionId: string; answer: string }>,
  ): Promise<SherlockSubmissionResultDto> {
    const sherlock = await this.deps.repo.findSherlockByLabId(labId);
    if (!sherlock) {
      throw new NotFoundError('Sherlock configuration not found for this lab.');
    }
    if (await this.deps.repo.hasLabCompletionEvent(userId, labId)) {
      throw new ConflictError('This lab has already been completed.');
    }

    const expected = sherlock.answers ?? [];
    const results: Array<{ questionId: string; passed: boolean }> = expected.map((expectedAnswer) => {
      const submitted = answers.find((answer) => answer.questionId === expectedAnswer.id);
      const passed =
        submitted !== undefined &&
        normalize(submitted.answer) === normalize(expectedAnswer.answer);
      return { questionId: expectedAnswer.id, passed };
    });

    const unanswered = answers.filter(
      (answer) => !expected.some((expectedAnswer) => expectedAnswer.id === answer.questionId),
    );
    for (const answer of unanswered) {
      results.push({ questionId: answer.questionId, passed: false });
    }

    const correctCount = results.filter((result) => result.passed).length;
    const required = sherlock.requiredCorrectAnswers;
    const isPassed = correctCount >= required;

    if (isPassed) {
      const activeInstance = await this.deps.repo.findAnyActiveInstanceForUser(userId);
      const startedAt = activeInstance
        ? await this.deps.repo.findLabStartTime(userId, activeInstance.instanceId)
        : null;
      const event: LabCompletionEvent = {
        labId,
        labType: 'sherlock',
        instanceId: activeInstance?.instanceId ?? null,
        passedAt: new Date().toISOString(),
        timeTakenSeconds: startedAt ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)) : null,
      };
      await activityLogService.recordEvent(userId, 'LAB_COMPLETED', { ...event });
    }

    return {
      labId,
      results,
      isPassed,
      score: Math.round((correctCount / Math.max(results.length, 1)) * 100),
    };
  }
}

export const sherlockService = new SherlockService();