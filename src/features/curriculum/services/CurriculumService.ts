import { env } from '../../../app/config';
import { ERROR_CODES, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { courseAccessService, type CourseAccessService } from '../../orgs/services/course-access.service';
import type { OrgActor } from '../../orgs/dto/org.dto';
import { parseLabSpec } from '../../labs/validators/lab-spec.validator';
import type {
  CourseDto,
  CourseSnapshot,
  LearnerCourseDetailDto,
  LessonSnapshot,
  LessonDto,
  ModuleDto,
  ModuleItemDto,
  ModuleSnapshot,
  QuizDto,
  QuizSnapshot,
  TagDto,
} from '../dto/curriculum.dto';
import {
  curriculumRepository,
  type CourseRow,
  type LessonRow,
  type ModuleItemRow,
  type ModuleRow,
  type QuizRow,
} from '../repositories/curriculum.repository';

export interface CurriculumServiceDeps {
  repo: typeof curriculumRepository;
  access: Pick<CourseAccessService, 'getCourseAccess'>;
}

function defaultDeps(): CurriculumServiceDeps {
  return { repo: curriculumRepository, access: courseAccessService };
}

/** Published course with its learner-visible module and item counts (`GET /curriculum/courses`). */
export interface LearnerCourseListItemDto extends CourseDto {
  moduleCount: number;
  itemCount: number;
}

/**
 * Learner read path (C§4.2). Outline reads (courses, modules, items) return 200
 * for any published course and carry no content. Content reads (`getLesson`)
 * enforce course access and return 403 `COURSE_ACCESS_DENIED` when the learner
 * is not entitled. Unpublished courses, modules and items are 404 everywhere,
 * never 403, so existence is not leaked.
 *
 * Also exports the consumable snapshot hooks (F5/F6/F7/F9): getCourseSnapshot,
 * getModuleById, getLessonById, getQuizById.
 */
export class CurriculumService {
  constructor(private readonly deps: CurriculumServiceDeps = defaultDeps()) {}

  /** Published course catalog with module and item counts (`GET /curriculum/courses`). */
  async listCourses(): Promise<LearnerCourseListItemDto[]> {
    const rows = await this.deps.repo.listPublishedCourses();
    const courses: LearnerCourseListItemDto[] = [];
    for (const row of rows) {
      const modules = await this.deps.repo.listModules(row.courseId, { publishedOnly: true });
      courses.push({
        ...toCourseDto(row),
        moduleCount: modules.length,
        itemCount: modules.reduce((sum, module) => sum + module.lessonCount, 0),
      });
    }
    return courses;
  }

  /**
   * Course outline with the caller's access state (`GET /curriculum/courses/:courseId`).
   * Readable for any published course so a locked course can show its upgrade path.
   */
  async getCourseDetail(actor: OrgActor, courseId: number): Promise<LearnerCourseDetailDto> {
    const course = await this.findPublishedCourse(courseId);
    if (!course) {
      throw courseNotFound();
    }
    const modules = await this.deps.repo.listModules(courseId, { publishedOnly: true });
    const access = await this.deps.access.getCourseAccess(actor, courseId);
    return {
      course: toCourseDto(course),
      modules: modules.map((row) => toModuleDto(row)),
      access,
    };
  }

  /** Published modules of a published course, in module order (`GET /curriculum/courses/:courseId/modules`). */
  async listCourseModules(courseId: number): Promise<ModuleDto[]> {
    const course = await this.findPublishedCourse(courseId);
    if (!course) {
      throw courseNotFound();
    }
    const rows = await this.deps.repo.listModules(courseId, { publishedOnly: true });
    return rows.map((row) => toModuleDto(row));
  }

  /** Single published module (`GET /curriculum/modules/:moduleId`). */
  async getModule(moduleId: number): Promise<ModuleDto> {
    const module = await this.findPublishedModule(moduleId);
    if (!module) {
      throw moduleNotFound();
    }
    return toModuleDto(module);
  }

  /** Learner-visible items of a published module in order (`GET /curriculum/modules/:moduleId/items`). */
  async listModuleItems(moduleId: number): Promise<ModuleItemDto[]> {
    const module = await this.findPublishedModule(moduleId);
    if (!module) {
      throw moduleNotFound();
    }
    const rows = await this.deps.repo.listItemsByModule(moduleId, { publishedOnly: true });
    return rows.map((row) => toModuleItemDto(row));
  }

  /**
   * Item content read (`GET /curriculum/lessons/:lessonId`). Publish-chain 404 comes
   * before the access check, so unpublished content never answers 403.
   * Lab and quiz items carry no content: the client redirects to the lab or quiz page.
   */
  async getLesson(actor: OrgActor, lessonId: number): Promise<LessonDto> {
    const item = await this.deps.repo.findItemById(lessonId);
    if (!item || !isLearnerVisibleItem(item)) {
      throw lessonNotFound();
    }
    const module = await this.findPublishedModule(item.moduleId);
    if (!module) {
      throw lessonNotFound();
    }

    const access = await this.deps.access.getCourseAccess(actor, module.courseId);
    if (!access.canAccess) {
      const message = access.message
        ?? 'You do not have access to this course. Ask your organization admin for access.';
      throw new ForbiddenError(message, [
        { code: ERROR_CODES.COURSE_ACCESS_DENIED, reason: access.reason, message },
      ]);
    }

    const row = await this.deps.repo.findLessonById(lessonId);
    if (!row) {
      throw lessonNotFound();
    }
    const tags = await this.deps.repo.listLessonTags(lessonId);
    return toLessonDto(row, module, tags);
  }

  /* ── §02 consumable snapshots (F5/F6/F7/F9 integration hooks) ───────── */

  /** Course snapshot for an explicit course id (progress and certificate hooks). */
  async getCourseSnapshot(courseId: number): Promise<CourseSnapshot> {
    const course = await this.deps.repo.findCourseById(courseId);
    if (!course) {
      throw new NotFoundError('The course is not available yet.', [{ code: ERROR_CODES.COURSE_NOT_FOUND }]);
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

  /** Published course row, or null when the course is missing or unpublished. */
  private async findPublishedCourse(courseId: number): Promise<CourseRow | null> {
    const course = await this.deps.repo.findCourseById(courseId);
    return course && course.isPublished ? course : null;
  }

  /**
   * Module row with its learner-visible counts, or null when the module, or its
   * course, is unpublished. The visible row comes from the published list so
   * `lessonCount` counts only learner-visible items.
   */
  private async findPublishedModule(moduleId: number): Promise<ModuleRow | null> {
    const module = await this.deps.repo.findModuleById(moduleId);
    if (!module || !module.isPublished) {
      return null;
    }
    const course = await this.findPublishedCourse(module.courseId);
    if (!course) {
      return null;
    }
    const visible = await this.deps.repo.listModules(module.courseId, { publishedOnly: true });
    return visible.find((row) => row.moduleId === moduleId) ?? null;
  }
}

function courseNotFound(): NotFoundError {
  return new NotFoundError('Course not found.', [{ code: ERROR_CODES.COURSE_NOT_FOUND }]);
}

function moduleNotFound(): NotFoundError {
  return new NotFoundError('Module not found.');
}

function lessonNotFound(): NotFoundError {
  return new NotFoundError('Lesson not found.', [{ code: ERROR_CODES.LESSON_NOT_FOUND }]);
}

/** Learner visibility of one item: published, with an active lab or a published quiz when it is that kind. */
function isLearnerVisibleItem(item: ModuleItemRow): boolean {
  if (!item.isPublished) {
    return false;
  }
  if (item.kind === 'lab') {
    return item.lab !== null && item.lab.isActive;
  }
  if (item.kind === 'quiz') {
    return item.quiz !== null && item.quiz.isPublished;
  }
  return true;
}

/**
 * Module deck URL (C§11.2): `${SLIDES_PUBLIC_BASE_URL}/slides/<moduleSlug>.pdf`.
 * Null when slides are disabled (empty base URL) or the module has no slug.
 */
export function moduleSlidesUrl(moduleSlug: string | null): string | null {
  const base = env.SLIDES_PUBLIC_BASE_URL;
  if (!base || !moduleSlug) {
    return null;
  }
  return `${base}/slides/${moduleSlug}.pdf`;
}

/** Lab spec status and step count read from `pro_labs.flag_values` (never throws). */
export function labSpecStatusOf(flagValues: unknown): {
  specStatus: 'v2' | 'legacy' | 'missing' | 'invalid';
  stepCount: number;
} {
  const parsed = parseLabSpec(flagValues);
  return {
    specStatus: parsed.kind,
    stepCount: parsed.kind === 'v2' ? parsed.spec.steps.length : 0,
  };
}

/** Learner item mapping (C§4.2). Carries titles and counts only, never content or spec secrets. */
export function toModuleItemDto(row: ModuleItemRow): ModuleItemDto {
  return {
    itemId: row.itemId,
    moduleId: row.moduleId,
    position: row.position,
    kind: row.kind,
    title: row.title,
    slug: row.slug,
    contentType: row.contentType,
    videoDurationSeconds: row.videoDurationSeconds,
    lab: row.lab
      ? {
        labId: row.lab.labId,
        slug: row.lab.slug,
        labName: row.lab.labName,
        difficultyName: row.lab.difficultyName,
        estimatedHours: row.lab.estimatedHours,
        stepCount: labSpecStatusOf(row.lab.flagValues).stepCount,
        isPremium: row.lab.isPremium,
      }
      : null,
    quiz: row.quiz
      ? {
        quizId: row.quiz.quizId,
        questionCount: row.quiz.activeQuestionCount,
        passingScore: row.quiz.passingScore,
        timeLimitMinutes: row.quiz.timeLimitMinutes,
        isRequired: row.quiz.isRequired,
      }
      : null,
  };
}

/** Field-by-field lesson item mapping (lab and quiz items carry no content of their own). */
export function toLessonDto(row: LessonRow, module: ModuleRow, tags: TagDto[]): LessonDto {
  const kind = row.contentType === 'lab' ? 'lab' : row.contentType === 'quiz' ? 'quiz' : 'lesson';
  return {
    lessonId: row.lessonId,
    moduleId: row.moduleId,
    courseId: module.courseId,
    title: row.title,
    slug: row.slug,
    moduleSlug: module.slug,
    slidesUrl: moduleSlidesUrl(module.slug),
    kind,
    labId: kind === 'lab' ? row.labId : null,
    quizId: kind === 'quiz' ? row.quizId : null,
    content: kind === 'lesson' ? row.content : null,
    contentType: row.contentType,
    videoUrl: kind === 'lesson' ? row.videoUrl : null,
    videoDurationSeconds: row.videoDurationSeconds,
    lessonOrder: row.lessonOrder,
    tags,
    isPublished: row.isPublished,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
    isPremium: course.isPremium,
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
    slug: row.slug,
    estimatedMinutes: row.estimatedMinutes,
    lessonCount: row.lessonCount,
    isPublished: row.isPublished,
    slidesUrl: moduleSlidesUrl(row.slug),
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
