/**
 * F5 response DTOs. All dates are ISO strings. Mirrors the contract §07
 * endpoint response shapes and the §02 consumable output contracts.
 */

import type { LabInstanceStatus, XpDeltaDto } from '../../labs/dto/labs.dto';

export type LearningActivityType =
  | 'LESSON_STARTED'
  | 'LESSON_COMPLETED'
  | 'MODULE_COMPLETED'
  | 'LAB_STARTED'
  | 'LAB_COMPLETED'
  | 'LAB_FAILED'
  | 'LAB_TERMINATED'
  | 'TRACK_COMPLETED'
  | 'AI_MENTOR_SESSION'
  | 'QUIZ_STARTED'
  | 'QUIZ_PASSED'
  | 'QUIZ_FAILED'
  | 'COURSE_COMPLETED'
  | 'LAB_STEP_STAGED'
  | 'LAB_STEP_PASSED'
  | 'LAB_STEP_FAILED'
  | 'LAB_HINT_REVEALED'
  | 'QUIZ_TERMINAL_STAGED';

/** Lesson-grain progress row (user_progress with lesson_id set). */
export interface LessonProgressDto {
  progressId: number;
  lessonId: number;
  moduleId: number;
  courseId: number;
  progressPercentage: number;
  isCompleted: boolean;
  completedAt: string | null;
  lastAccessedAt: string;
  timeSpentSeconds: number;
}

/** Computed module aggregate (not a table). */
export interface ModuleProgressSummary {
  moduleId: number;
  moduleTitle: string;
  moduleOrder: number;
  totalLessons: number;
  completedLessons: number;
  progressPercentage: number;
  isCompleted: boolean;
}

/** Computed course aggregate (not a table). */
export interface CourseProgressDto {
  courseId: number;
  courseTitle: string;
  progressPercentage: number;
  completedLessonCount: number;
  totalLessons: number;
  isCompleted: boolean;
}

/** Kind of a published module item (lesson, lab or quiz). */
export type ModuleItemKind = 'lesson' | 'lab' | 'quiz';

/** §02 continue-learning pointer: last-accessed item with its context. FE routes by `kind`. */
export interface ContinueLearningPointerDto {
  lessonId: number;
  moduleId: number;
  courseId: number;
  lessonTitle: string;
  moduleTitle: string;
  progressPct: number;
  lastAccessedAt: string;
  kind: ModuleItemKind;
  labId: number | null;
  quizId: number | null;
}

/** Activity history item from activity_logs. */
export interface ActivityLogDto {
  logId: number;
  activityType: LearningActivityType;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** One student row in the professor / org-admin class progress table. */
export interface StudentProgressDto {
  userId: number;
  fullName: string | null;
  email: string;
  progressPercentage: number;
  completedLessonCount: number;
  totalLessons: number;
  completedModuleCount: number;
  labsCompleted: number;
  lastActiveAt: string | null;
  currentStreakDays: number;
}

/** SCR-F5-03: class-level module average row (module name, avg % for class). */
export interface ModuleAverageDto {
  moduleId: number;
  moduleTitle: string;
  totalLessons: number;
  averageProgressPercentage: number;
}

/** Courses selectable in staff views (the class's assigned courses / the student's started courses). */
export interface CourseOptionDto {
  courseId: number;
  title: string;
}

/** Professor / org-admin drill-down into one student. */
export interface StudentDetailProgressDto {
  student: {
    userId: number;
    fullName: string | null;
    email: string;
  };
  course: CourseProgressDto | null;
  modules: ModuleProgressSummary[];
  activity: ActivityLogDto[];
  courseOptions: CourseOptionDto[];
}

/** Professor / org-admin class progress table response (`/progress/class/:classId/students`). */
export interface ClassStudentsProgressDto {
  className: string;
  students: StudentProgressDto[];
  moduleAverages: ModuleAverageDto[];
  courseOptions: CourseOptionDto[];
}

/** Org-admin aggregate listing. */
export interface OrgStudentProgressDto extends StudentProgressDto {
  className: string | null;
}

/** Platform-admin full progress view for a single user. */
export interface AdminUserProgressDto {
  user: {
    userId: number;
    username: string;
    email: string;
    fullName: string | null;
  };
  course: CourseProgressDto | null;
  modules: ModuleProgressSummary[];
  quizAttempts: QuizAttemptDto[];
  activity: ActivityLogDto[];
  courseOptions: CourseOptionDto[];
}

/** Quiz attempt record. */
export interface QuizAttemptDto {
  attemptId: number;
  quizId: number;
  score: number;
  isPassed: boolean;
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  timeTakenSeconds: number | null;
}

/** PATCH /progress/lessons/:lessonId/complete success payload (C§4.3). */
export interface LessonCompleteResultDto {
  lesson: LessonProgressDto;
  newlyCompleted: boolean;
  moduleNewlyCompleted: boolean;
  courseNewlyCompleted: boolean;
  xp: XpDeltaDto;
}

/** One published item of a module (GET /progress/modules/:moduleId/items). */
export interface ModuleItemProgressDto {
  itemId: number;
  kind: ModuleItemKind;
  isStarted: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  lab?: { passedSteps: number; totalSteps: number };
  quiz?: { isPassed: boolean; bestScore: number | null; attemptsUsedToday: number };
}

/** Learner quiz intro (GET /progress/quizzes/:quizId). */
export interface QuizStatusDto {
  quizId: number;
  moduleId: number;
  courseId: number;
  title: string;
  description: string | null;
  passingScore: number;
  timeLimitMinutes: number | null;
  questionCount: number;
  totalPoints: number;
  isPassed: boolean;
  bestScore: number | null;
  /** Attempts started in the rolling 24 h window. */
  attemptsUsedToday: number;
  /** QUIZ_LIMITS.maxAttemptsPerDay; 0 = unlimited. */
  maxAttemptsPerDay: number;
  /** Cooldown or daily-cap expiry; null when a new attempt may start now. */
  nextAttemptAt: string | null;
  openAttemptId: number | null;
  /** Maxima over the active questions (penalties are per question). */
  penalties: { wrongAnswerMax: number; terminalGuessMax: number };
  /** FE shows the guess-penalty disclosure only when true. */
  hasTerminalQuestions: boolean;
  /** First passed attempt, for Review. */
  passedAttemptId: number | null;
  lastAttempt: { attemptId: number; score: number; isPassed: boolean; completedAt: string | null } | null;
}

export type QuizQuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'multiple_select'
  | 'bucket_sort'
  | 'ordering'
  | 'terminal';

/** Learner-safe answer submitted for one question (mirrors submitQuizAnswerSchema). */
export type QuizAnswerResponse =
  | { type: 'choice'; answerId: number }
  | { type: 'multi'; answerIds: number[] }
  | { type: 'text'; text: string }
  | { type: 'ordering'; answerIds: number[] }
  | { type: 'buckets'; placements: Array<{ answerId: number; bucket: number }> }
  | { type: 'terminal_check' };

/** Terminal block of a learner question. Setup and check commands are never included. */
export interface TerminalStageDto {
  attemptId: number;
  questionId: number;
  instanceId: number;
  status: LabInstanceStatus;
  terminalWsUrl: string | null;
  expiresAt: string | null;
  stagedAt: string;
  provisioned: boolean;
}

/** Learner-safe quiz question inside an attempt (no isCorrect, answerOrder, explanation or config). */
export interface LearnerQuizQuestionDto {
  questionId: number;
  position: number;
  questionText: string;
  questionType: QuizQuestionType;
  points: number;
  instructions: string | null;
  /** bucket_sort only. */
  buckets: string[] | null;
  /** [] for fill_blank and terminal text/check. */
  options: Array<{ answerId: number; answerText: string }>;
  terminal: null | {
    labId: number;
    labName: string;
    mode: 'answer' | 'check';
    answerFormat: 'choice' | 'text' | null;
    /** Latest QUIZ_TERMINAL_STAGED of this attempt and question. */
    staged: { instanceId: number; stagedAt: string } | null;
  };
  /** Per-question values from quiz_questions.config (0 when absent). */
  penalties: { wrongAnswer: number; guess: number };
  /** Set when this question was already answered in this attempt. */
  response: QuizAnswerResultDto | null;
}

/** Server-created attempt (POST .../attempts/start, GET /progress/quiz-attempts/:attemptId). */
export interface QuizAttemptStartDto {
  attemptId: number;
  quizId: number;
  attemptNumber: number;
  startedAt: string;
  expiresAt: string | null;
  passingScore: number;
  totalQuestions: number;
  totalPoints: number;
  questions: LearnerQuizQuestionDto[];
}

/** Immediate per-question feedback (POST .../answers). */
export interface QuizAnswerResultDto {
  questionId: number;
  isCorrect: boolean;
  pointsEarned: number;
  guessed: boolean;
  penalties: { wrongAnswer: number; guess: number };
  explanation: string | null;
  answeredAt: string;
  xp: XpDeltaDto;
}

/** Completed attempt summary (POST .../complete and GET /progress/quiz-attempts/:attemptId `result`). */
export interface QuizAttemptResultDto {
  attemptId: number;
  quizId: number;
  score: number;
  isPassed: boolean;
  passingScore: number;
  correctCount: number;
  answeredCount: number;
  totalQuestions: number;
  timeTakenSeconds: number;
  firstPass: boolean;
  /** Pass reward: sum of points earned on the first pass, else 0. */
  xpAwarded: number;
  penaltiesTotal: number;
  breakdown: Array<{ questionId: number; isCorrect: boolean; pointsEarned: number; explanation: string | null }>;
  reviewAvailable: boolean;
  completedLessonIds: number[];
  xp: XpDeltaDto;
}

/** Review after the quiz is passed (GET /progress/quiz-attempts/:attemptId/review). */
export interface QuizReviewDto {
  attemptId: number;
  questions: Array<{
    questionId: number;
    questionText: string;
    questionType: string;
    yourResponse: unknown;
    isCorrect: boolean;
    explanation: string | null;
    correct: {
      answerIds?: number[];
      orderedAnswerIds?: number[];
      placements?: Array<{ answerId: number; bucket: number }>;
      text?: string;
    } | null;
  }>;
}
