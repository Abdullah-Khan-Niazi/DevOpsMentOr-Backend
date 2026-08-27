/**
 * F4 response DTOs. All dates are ISO strings; curriculum identifiers are
 * numbers. Mirrors the contract §07 endpoint response shapes and the
 * consumable snapshot shapes (§02).
 */

import type { questionTypes } from '../validators/curriculum.validator';

export type ContentType = 'text' | 'video' | 'interactive' | 'lab';
export type QuestionType = (typeof questionTypes)[number];

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
  coverImageUrl: string | null;
  videoTrailerUrl: string | null;
  estimatedHours: number;
  totalLessons: number;
  totalQuizzes: number;
  isPublished: boolean;
  prerequisites: string[] | null;
  learningObjectives: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleDto {
  moduleId: number;
  courseId: number;
  title: string;
  description: string | null;
  moduleOrder: number;
  estimatedMinutes: number;
  lessonCount: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LessonDto {
  lessonId: number;
  moduleId: number;
  title: string;
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

export interface QuestionDto {
  questionId: number;
  quizId: number;
  questionText: string;
  questionType: QuestionType;
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

export interface CourseOverviewDto {
  course: CourseDto;
  modules: ModuleDto[];
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
