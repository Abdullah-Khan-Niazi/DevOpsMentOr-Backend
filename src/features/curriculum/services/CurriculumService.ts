import { NotFoundError } from '../../../shared/errors';
import type {
  CourseDto,
  CourseSnapshot,
  CourseOverviewDto,
  LessonSnapshot,
  LessonDto,
  ModuleDto,
  ModuleSnapshot,
  QuizDto,
  QuizSnapshot,
  TagDto,
} from '../dto/curriculum.dto';
import {
  curriculumRepository,
  type CourseRow,
  type LessonRow,
  type ModuleRow,
  type QuizRow,
} from '../repositories/curriculum.repository';

export interface CurriculumServiceDeps {
  repo: typeof curriculumRepository;
}

function defaultDeps(): CurriculumServiceDeps {
  return { repo: curriculumRepository };
}

/**
 * F4 §08: learner read path for PUBLISHED curriculum content only.
 * Every query applies `WHERE is_published = TRUE` at the SQL level; DRAFT and
 * ARCHIVED content is completely absent from these responses.
 *
 * Also exports the consumable snapshot hooks (F5/F6/F7/F9): getCourseSnapshot,
 * getModuleById, getLessonById, getQuizById.
 */
export class CurriculumService {
  constructor(private readonly deps: CurriculumServiceDeps = defaultDeps()) {}

  async getCourse(): Promise<CourseOverviewDto> {
    const course = await this.deps.repo.getCanonicalCourse();
    if (!course) {
      throw new NotFoundError('The course is not available yet.');
    }
    const modules = await this.getPublishedModules();
    return { course: toCourseDto(course), modules };
  }

  /** F4-API-02: published modules with live published-lesson counts. */
  async getPublishedModules(): Promise<ModuleDto[]> {
    const rows = await this.deps.repo.listModulesPublished();
    return rows.map((row) => ({
      moduleId: row.moduleId,
      courseId: row.courseId,
      title: row.title,
      description: row.description,
      moduleOrder: row.moduleOrder,
      estimatedMinutes: row.estimatedMinutes,
      lessonCount: row.lessonCount,
      isPublished: true,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** F4-API-03: single published module (404 for DRAFT/ARCHIVED). */
  async getPublishedModuleById(moduleId: number): Promise<ModuleDto> {
    const row = await this.deps.repo.findModuleById(moduleId);
    if (!row || !row.isPublished) {
      throw new NotFoundError('Module not found.');
    }
    return {
      moduleId: row.moduleId,
      courseId: row.courseId,
      title: row.title,
      description: row.description,
      moduleOrder: row.moduleOrder,
      estimatedMinutes: row.estimatedMinutes,
      lessonCount: row.lessonCount,
      isPublished: true,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** F4-API-04: published lessons of a published module, with tags. */
  async getPublishedLessons(moduleId: number): Promise<LessonDto[]> {
    const module = await this.deps.repo.findModuleById(moduleId);
    if (!module || !module.isPublished) {
      throw new NotFoundError('Module not found.');
    }
    const rows = await this.deps.repo.listPublishedLessonsByModule(moduleId);
    return Promise.all(rows.map((row) => this.toLessonDto(row)));
  }

  /** F4-API-05: single published lesson (404 for DRAFT, AC-07). */
  async getPublishedLesson(lessonId: number): Promise<LessonDto> {
    const row = await this.deps.repo.findLessonById(lessonId);
    if (!row || !row.isPublished) {
      throw new NotFoundError('Lesson not found.');
    }
    return this.toLessonDto(row);
  }

  /** F4-API-06: published quiz metadata for a published module. Answers are
   * never included; question counts are derived (AC-04). */
  async getPublishedQuizzes(moduleId: number): Promise<QuizDto[]> {
    const module = await this.deps.repo.findModuleById(moduleId);
    if (!module || !module.isPublished) {
      throw new NotFoundError('Module not found.');
    }
    const rows = await this.deps.repo.listPublishedQuizzesByModule(moduleId);
    const quizzes: QuizDto[] = [];
    for (const row of rows) {
      quizzes.push({
        ...toQuizBaseDto(row),
        questionCount: await this.deps.repo.countQuestionsByQuiz(row.quizId),
      });
    }
    return quizzes;
  }

  /* ── §02 consumable snapshots (F5/F6/F7/F9 integration hooks) ───────── */

  async getCourseSnapshot(): Promise<CourseSnapshot> {
    const course = await this.deps.repo.getCanonicalCourse();
    if (!course) {
      throw new NotFoundError('The course is not available yet.');
    }
    return {
      courseId: course.courseId,
      title: course.title,
      totalModules: await this.deps.repo.countModulesByCourse(course.courseId),
      totalLessons: course.totalLessons,
      totalQuizzes: course.totalQuizzes,
    };
  }

  /** F6 hook: validate a lab-to-module association (any state). */
  async getModuleById(moduleId: number): Promise<ModuleSnapshot | null> {
    const row = await this.deps.repo.findModuleById(moduleId);
    if (!row) {
      return null;
    }
    return {
      moduleId: row.moduleId,
      courseId: row.courseId,
      title: row.title,
      moduleOrder: row.moduleOrder,
      estimatedMinutes: row.estimatedMinutes,
      isPublished: row.isPublished,
    };
  }

  /** F5 hook: lesson lookup for progress writes. */
  async getLessonById(lessonId: number): Promise<LessonSnapshot | null> {
    const row = await this.deps.repo.findLessonById(lessonId);
    if (!row) {
      return null;
    }
    return {
      lessonId: row.lessonId,
      moduleId: row.moduleId,
      title: row.title,
      contentType: row.contentType,
      lessonOrder: row.lessonOrder,
      isPublished: row.isPublished,
    };
  }

  /** F5 hook: quiz lookup for attempt service. */
  async getQuizById(quizId: number): Promise<QuizSnapshot | null> {
    const row = await this.deps.repo.findQuizById(quizId);
    if (!row) {
      return null;
    }
    return {
      quizId: row.quizId,
      moduleId: row.moduleId,
      passingScore: row.passingScore,
      timeLimitMinutes: row.timeLimitMinutes,
      isRequired: row.isRequired,
    };
  }

  private async toLessonDto(row: LessonRow): Promise<LessonDto> {
    const tags = await this.deps.repo.listLessonTags(row.lessonId);
    return {
      lessonId: row.lessonId,
      moduleId: row.moduleId,
      title: row.title,
      content: row.content,
      contentType: row.contentType,
      videoUrl: row.videoUrl,
      videoDurationSeconds: row.videoDurationSeconds,
      lessonOrder: row.lessonOrder,
      tags,
      isPublished: row.isPublished,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export function toCourseDto(course: CourseRow): CourseDto {
  return {
    courseId: course.courseId,
    title: course.title,
    slug: course.slug,
    description: course.description,
    difficultyId: course.difficultyId,
    difficultyName: course.difficultyName,
    categoryId: course.categoryId,
    categoryName: course.categoryName,
    instructorId: course.instructorId,
    instructorName: course.instructorName,
    coverImageUrl: course.coverImageUrl,
    videoTrailerUrl: course.videoTrailerUrl,
    estimatedHours: course.estimatedHours,
    totalLessons: course.totalLessons,
    totalQuizzes: course.totalQuizzes,
    isPublished: course.isPublished,
    prerequisites: course.prerequisites,
    learningObjectives: course.learningObjectives,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

export function toModuleDto(row: ModuleRow): ModuleDto {
  return {
    moduleId: row.moduleId,
    courseId: row.courseId,
    title: row.title,
    description: row.description,
    moduleOrder: row.moduleOrder,
    estimatedMinutes: row.estimatedMinutes,
    lessonCount: row.lessonCount,
    isPublished: row.isPublished,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toQuizBaseDto(row: QuizRow): Omit<QuizDto, 'questionCount'> {
  return {
    quizId: row.quizId,
    moduleId: row.moduleId,
    title: row.title,
    description: row.description,
    passingScore: row.passingScore,
    timeLimitMinutes: row.timeLimitMinutes,
    isRequired: row.isRequired,
    isPublished: row.isPublished,
  };
}

export function toTagDto(tag: TagDto): TagDto {
  return { tagId: tag.tagId, tagName: tag.tagName };
}

export const curriculumService = new CurriculumService();
