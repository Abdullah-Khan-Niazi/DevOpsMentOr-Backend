import { NotFoundError } from '../../../shared/errors';
import { activityLogService } from '../../progress/services/ActivityLogService';
import type {
  TrackDetailDto,
  TrackDto,
  TrackProgressDto,
  TrackProgressItemDto,
} from '../dto/labs.dto';
import type { LabsRepository, TrackRow } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

export interface TrackServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'listTracks'
    | 'findTrackById'
    | 'listTrackContent'
    | 'listCompletedLabIdsForUser'
    | 'listCompletedLessonIdsForUser'
    | 'hasTrackCompletionEvent'
  >;
}

function defaultDeps(): TrackServiceDeps {
  return { repo: labsRepository };
}

/**
 * F6 §08 tracks: catalog + progress. Progress is derived exclusively from
 * activity events (LAB_COMPLETED / LESSON_COMPLETED) — `user_progress` is
 * never read here (F5 owns that table). TRACK_COMPLETED is recorded once on
 * the completing call.
 */
export class TrackService {
  constructor(private readonly deps: TrackServiceDeps = defaultDeps()) {}

  async listTracks(): Promise<TrackDto[]> {
    const rows = await this.deps.repo.listTracks(false);
    return rows.map((row) => this.toTrackDto(row));
  }

  async getTrackDetail(trackId: number, userId: number | null): Promise<TrackDetailDto> {
    const track = await this.deps.repo.findTrackById(trackId);
    if (!track || !track.isActive) {
      throw new NotFoundError('Track not found.');
    }
    const content = await this.deps.repo.listTrackContent(trackId);

    let completedLabIds: number[] = [];
    let completedLessonIds: number[] = [];
    if (userId !== null) {
      [completedLabIds, completedLessonIds] = await Promise.all([
        this.deps.repo.listCompletedLabIdsForUser(userId),
        this.deps.repo.listCompletedLessonIdsForUser(userId),
      ]);
    }

    return {
      ...this.toTrackDto(track),
      totalLabs: content.filter((item) => item.contentType === 'lab').length,
      totalCourses: content.filter((item) => item.contentType === 'course').length,
      items: content.map((item) => ({
        trackId,
        contentType: item.contentType,
        contentId: item.contentId,
        displayOrder: item.displayOrder,
        required: item.required,
        title: item.title,
        completed:
          item.contentType === 'lab'
            ? completedLabIds.includes(item.contentId)
            : completedLessonIds.includes(item.contentId),
      })),
    };
  }

  async getTrackProgress(userId: number, trackId: number): Promise<TrackProgressDto> {
    const track = await this.deps.repo.findTrackById(trackId);
    if (!track || !track.isActive) {
      throw new NotFoundError('Track not found.');
    }
    const content = await this.deps.repo.listTrackContent(trackId);
    const [completedLabIds, completedLessonIds] = await Promise.all([
      this.deps.repo.listCompletedLabIdsForUser(userId),
      this.deps.repo.listCompletedLessonIdsForUser(userId),
    ]);

    const items: TrackProgressItemDto[] = content.map((item) => {
      const completed =
        item.contentType === 'lab'
          ? completedLabIds.includes(item.contentId)
          : completedLessonIds.includes(item.contentId);
      return {
        trackId,
        contentType: item.contentType,
        contentId: item.contentId,
        displayOrder: item.displayOrder,
        required: item.required,
        title: item.title,
        completed,
      };
    });

    const requiredItems = items.filter((item) => item.required);
    const totalRequired = requiredItems.length;
    const completedRequired = requiredItems.filter((item) => item.completed).length;
    const isCompleted = totalRequired > 0 && completedRequired >= totalRequired;

    if (isCompleted && !(await this.deps.repo.hasTrackCompletionEvent(userId, trackId))) {
      await activityLogService.recordEvent(userId, 'TRACK_COMPLETED', {
        trackId,
        title: track.trackName,
        completedAt: new Date().toISOString(),
      });
    }

    return {
      trackId,
      trackName: track.trackName,
      slug: track.slug,
      totalItems: items.length,
      completedItems: items.filter((item) => item.completed).length,
      totalRequired: requiredItems.length > 0 ? requiredItems.length : null,
      completedRequired: completedRequired,
      isCompleted,
      progressPercentage: totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0,
      items,
    };
  }

  private toTrackDto(row: TrackRow): TrackDto {
    return {
      trackId: row.trackId,
      trackName: row.trackName,
      slug: row.slug,
      description: row.description,
      difficultyId: row.difficultyId,
      difficultyName: row.difficultyName,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      totalLabs: row.totalLabs,
      isActive: row.isActive,
      isPremium: row.isPremium,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export const trackService = new TrackService();