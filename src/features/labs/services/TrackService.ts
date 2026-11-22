import { NotFoundError } from '../../../shared/errors';
import type { CourseProgressDto } from '../../progress/dto/progress.dto';
import type { ProgressService } from '../../progress/services/ProgressService';
import { progressService } from '../../progress/services/ProgressService';
import type {
  TrackContentItemDto,
  TrackDetailDto,
  TrackDto,
  TrackProgressDto,
  TrackProgressItemDto,
} from '../dto/labs.dto';
import type { LabsRepository, TrackContentRow, TrackRow } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

export interface TrackServiceDeps {
  repo: Pick<LabsRepository, 'listTracks' | 'findTrackById' | 'listTrackContent'>;
  progress: Pick<ProgressService, 'getCourseProgress'>;
}

function defaultDeps(): TrackServiceDeps {
  return { repo: labsRepository, progress: progressService };
}

/**
 * F6 §08 tracks, learner side (contracts §4.5). A track's content is courses
 * only (C1). Per-course progress comes from the course progress service (reads only).
 * The TRACK_COMPLETED event is written by the progress completion engine.
 */
export class TrackService {
  constructor(private readonly deps: TrackServiceDeps = defaultDeps()) {}

  async listTracks(): Promise<TrackDto[]> {
    const rows = await this.deps.repo.listTracks(false);
    return rows.map((row) => this.toTrackDto(row));
  }

  /** The active track with the lowest `track_id` (the single learner track). */
  async getDefaultTrack(): Promise<TrackDto> {
    const rows = await this.deps.repo.listTracks(false);
    const track = rows.reduce<TrackRow | null>(
      (lowest, row) => (lowest === null || row.trackId < lowest.trackId ? row : lowest),
      null,
    );
    if (!track) {
      throw new NotFoundError('Track not found.');
    }
    return this.toTrackDto(track);
  }

  async getTrackDetail(trackId: number, userId: number | null): Promise<TrackDetailDto> {
    const track = await this.requireActiveTrack(trackId);
    const courses = await this.loadCourseContent(trackId);

    const completedCourseIds = new Set<number>();
    if (userId !== null) {
      const progresses = await Promise.all(
        courses.map((item) => this.courseProgressOrNull(userId, item.contentId)),
      );
      courses.forEach((item, index) => {
        if (progresses[index]?.isCompleted) {
          completedCourseIds.add(item.contentId);
        }
      });
    }

    const items: TrackContentItemDto[] = courses.map((item) => ({
      trackId,
      contentType: 'course',
      contentId: item.contentId,
      displayOrder: item.displayOrder,
      required: item.required,
      title: item.title,
      completed: completedCourseIds.has(item.contentId),
    }));

    return {
      ...this.toTrackDto(track),
      totalCourses: courses.length,
      items,
    };
  }

  async getTrackProgress(userId: number, trackId: number): Promise<TrackProgressDto> {
    const track = await this.requireActiveTrack(trackId);
    const courses = await this.loadCourseContent(trackId);
    const progresses = await Promise.all(
      courses.map((item) => this.courseProgressOrNull(userId, item.contentId)),
    );

    const items: TrackProgressItemDto[] = courses.map((item, index) => {
      const progress: CourseProgressDto | null = progresses[index] ?? null;
      return {
        trackId,
        contentType: 'course',
        contentId: item.contentId,
        displayOrder: item.displayOrder,
        required: item.required,
        title: item.title,
        completed: progress?.isCompleted === true,
        progressPercentage: progress?.progressPercentage ?? 0,
      };
    });

    const requiredItems = items.filter((item) => item.required);
    const totalRequired = requiredItems.length;
    const completedRequired = requiredItems.filter((item) => item.completed).length;
    const isCompleted = totalRequired > 0 && completedRequired >= totalRequired;

    return {
      trackId,
      trackName: track.trackName,
      slug: track.slug,
      totalItems: items.length,
      completedItems: items.filter((item) => item.completed).length,
      totalRequired: totalRequired > 0 ? totalRequired : null,
      completedRequired,
      isCompleted,
      progressPercentage: totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0,
      items,
    };
  }

  private async requireActiveTrack(trackId: number): Promise<TrackRow> {
    const track = await this.deps.repo.findTrackById(trackId);
    if (!track || !track.isActive) {
      throw new NotFoundError('Track not found.');
    }
    return track;
  }

  /** Track content is courses only; lab rows are no longer attached to tracks. */
  private async loadCourseContent(trackId: number): Promise<TrackContentRow[]> {
    const content = await this.deps.repo.listTrackContent(trackId);
    return content.filter((item) => item.contentType === 'course');
  }

  /**
   * Course progress for one learner. A course that is not published has no
   * learner progress (the progress service answers 404), which reads as not started.
   */
  private async courseProgressOrNull(userId: number, courseId: number): Promise<CourseProgressDto | null> {
    try {
      return await this.deps.progress.getCourseProgress(userId, courseId);
    } catch (error: unknown) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
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
