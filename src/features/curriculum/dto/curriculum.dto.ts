/**
 * F4 response DTOs. All dates are ISO strings; curriculum identifiers are
 * numbers. Mirrors the contract §07 endpoint response shapes and the
 * consumable snapshot shapes (§02).
 */

import type { LabStepCheck } from '../../labs/dto/lab-spec.dto';
import type { CourseAccessDto } from '../../orgs/dto/org.dto';
import type { questionTypes } from '../validators/curriculum.validator';

export type { CourseAccessDto } from '../../orgs/dto/org.dto';

export type ContentType = 'text' | 'video' | 'interactive' | 'lab' | 'quiz';
export type QuestionType = (typeof questionTypes)[number];

/** Kind of a module item: a lesson body, a lab, or a quiz. */
export type ModuleItemKind = 'lesson' | 'lab' | 'quiz';

/** Actor identity for audit writes (same shape as F3 OrgActor). */
export interface CurriculumActor {
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TagDto {
  tagId: number;
  tagName: string;
}

export interface CourseDto {
  courseId: number;
  title: string;
  slug: string;
  description: string | null;
  difficultyId: number;
  difficultyName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  instructorId: number;
  instructorName: string | null;
  instructorAvatarUrl: string | null;
  instructorBio: string | null;
  coverImageUrl: string | null;
  videoTrailerUrl: string | null;
  estimatedHours: number;
  totalLessons: number;
  totalQuizzes: number;
  isPublished: boolean;
  isPremium: boolean;
  prerequisites: string[] | null;
  learningObjectives: string[] | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin course list row (`GET /admin/curriculum/courses`). */
export interface AdminCourseListItemDto extends CourseDto {
  moduleCount: number;
  itemCount: number;
  trackIds: number[];
}

export interface ModuleDto {
  moduleId: number;
  courseId: number;
  title: string;
  description: string | null;
  moduleOrder: number;
  /** Derived `CxxMxx` (C§11.1); null when the parent course slug is not `Cxx`. */
  slug: string | null;
  estimatedMinutes: number;
  lessonCount: number;
  isPublished: boolean;
  /** Module slide deck URL (C§11.2); null when slides are disabled. */
  slidesUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lab summary carried by a lab item. */
export interface ModuleItemLabDto {
  labId: number;
  slug: string;
  labName: string;
  difficultyName: string | null;
  estimatedHours: number;
  stepCount: number;
  isPremium: boolean;
}

/** Quiz summary carried by a quiz item. */
export interface ModuleItemQuizDto {
  quizId: number;
  questionCount: number;
  passingScore: number;
  timeLimitMinutes: number | null;
  isRequired: boolean;
}

/** One ordered item of a module (lesson, lab or quiz). Learner-safe. */
export interface ModuleItemDto {
  itemId: number;                      // lessons.lesson_id
  moduleId: number;
  position: number;                    // lessons.lesson_order
  kind: ModuleItemKind;
  title: string;
  /** `CxxMxxLxx`, server assigned for every kind (C§11.1); null when not derivable. */
  slug: string | null;
  contentType: ContentType;
  videoDurationSeconds: number | null;
  lab: ModuleItemLabDto | null;
  quiz: ModuleItemQuizDto | null;
}

/** Admin view of a module item, with publish state and learner-data flag. */
export interface AdminModuleItemDto extends ModuleItemDto {
  isPublished: boolean;
  lab: (ModuleItemDto['lab'] & {
    isActive: boolean;
    specStatus: 'v2' | 'legacy' | 'missing' | 'invalid';
  }) | null;
  quiz: (ModuleItemDto['quiz'] & {
    isPublished: boolean;
    activeQuestionCount: number;
  }) | null;
  hasLearnerData: boolean;
}

export interface LessonDto {
  lessonId: number;
  moduleId: number;
  /** Course that owns the lesson's module (C§4.2). */
  courseId: number;
  title: string;
  /** Item slug `CxxMxxLxx` (server assigned, C§11.1). */
  slug: string | null;
  /** Module slug `CxxMxx` of the module the item belongs to. */
  moduleSlug: string | null;
  /** Module slide deck URL for the item's module (C§11.2). */
  slidesUrl: string | null;
  kind: ModuleItemKind;
  /** Lab item: the lab definition. Null for lesson and quiz items. */
  labId: number | null;
  /** Quiz item: the quiz. Null for lesson and lab items. */
  quizId: number | null;
  content: string | null;
  contentType: ContentType;
  videoUrl: string | null;
  videoDurationSeconds: number | null;
  lessonOrder: number;
  isPublished: boolean;
  tags: TagDto[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizDto {
  quizId: number;
  moduleId: number;
  title: string;
  description: string | null;
  passingScore: number;
  timeLimitMinutes: number | null;
  isRequired: boolean;
  isPublished: boolean;
  questionCount: number;
}

/** Admin-only answer shape (isCorrect never leaves for learner roles). */
export interface AnswerDto {
  answerId: number;
  questionId: number;
  answerText: string;
  isCorrect: boolean;
  answerOrder: number;
}

/**
 * Terminal question config (C§4.4). `check` and `setup` are server-only and
 * appear only in admin payloads; learner shaping strips them (B3).
 */
export interface TerminalQuestionConfigDto {
  labId: number;
  mode: 'answer' | 'check';
  answerFormat: 'choice' | 'text' | null;
  setup: string[];
  check?: LabStepCheck;
}

/** Typed `quiz_questions.config`. Penalties are per question (C3). */
export interface QuestionConfigDto {
  instructions?: string;
  /** bucket_sort: bucket labels. */
  buckets?: string[];
  /** Penalty for a wrong answer (points). Absent on legacy rows: treated as 0. */
  wrongPenalty?: number;
  /** Penalty for a guessed terminal answer (points). Absent on legacy rows: treated as 0. */
  guessPenalty?: number;
  terminal?: TerminalQuestionConfigDto;
}

export interface QuestionDto {
  questionId: number;
  quizId: number;
  questionText: string;
  questionType: QuestionType;
  /** Presentation payload and penalties (never holds correctness). Null for legacy rows. */
  config: QuestionConfigDto | null;
  points: number;
  explanation: string | null;
  questionOrder: number;
  isActive: boolean;
  answers: AnswerDto[];
}

/** Learner-safe question: `is_correct` stripped at the service boundary. */
export interface LearnerQuestionDto extends Omit<QuestionDto, 'answers'> {
  answers: Array<Omit<AnswerDto, 'isCorrect'>>;
}

/** Module editor payload (SCR-F4-02/03/04): module + lessons + quizzes. */
export interface ModuleEditorDto extends ModuleDto {
  lessons: LessonDto[];
  quizzes: QuizDetailDto[];
}

export interface QuizDetailDto extends QuizDto {
  questions: QuestionDto[];
}

/** Learner course detail (`GET /curriculum/courses/:courseId`). The outline is
 * readable for any published course; `access` tells the client whether content
 * is unlocked (C§4.2). */
export interface LearnerCourseDetailDto {
  course: CourseDto;
  modules: ModuleDto[];
  access: CourseAccessDto;
}

export interface CourseResourceFileDto {
  id: string;
  title: string;
  kind: 'slides' | 'resource';
  fileName: string;
  url: string;
  downloadUrl: string;
  expiresAt: string;
}

export interface CourseWalkthroughResourceDto {
  labId: number;
  moduleId: number;
  moduleTitle: string;
  slug: string;
  title: string;
}

export interface CourseResourcesDto {
  courseId: number;
  slides: CourseResourceFileDto | null;
  files: CourseResourceFileDto[];
  walkthroughs: CourseWalkthroughResourceDto[];
}

/** ── §02 consumable snapshots (emitted for F5/F6/F7/F9) ────────────── */

export interface CourseSnapshot {
  courseId: number;
  title: string;
  totalModules: number;
  totalLessons: number;
  totalQuizzes: number;
}

export interface ModuleSnapshot {
  moduleId: number;
  courseId: number;
  title: string;
  moduleOrder: number;
  estimatedMinutes: number;
  isPublished: boolean;
}

export interface LessonSnapshot {
  lessonId: number;
  moduleId: number;
  title: string;
  contentType: ContentType;
  lessonOrder: number;
  isPublished: boolean;
}

export interface QuizSnapshot {
  quizId: number;
  moduleId: number;
  passingScore: number;
  timeLimitMinutes: number | null;
  isRequired: boolean;
}
