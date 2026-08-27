/**
 * F5 response DTOs. All dates are ISO strings. Mirrors the contract §07
 * endpoint response shapes and the §02 consumable output contracts.
 */

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
  | 'COURSE_COMPLETED';

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

/** §02 continue-learning pointer: last-accessed lesson with its context. */
export interface ContinueLearningPointerDto {
  lessonId: number;
  moduleId: number;
  courseId: number;
  lessonTitle: string;
  moduleTitle: string;
  progressPct: number;
  lastAccessedAt: string;
}

/** Activity history item from activity_logs. */
export interface ActivityLogDto {
  logId: number;
  activityType: LearningActivityType;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** §02 consumable snapshot for F7 achievement triggers / F8 analytics. */
export interface LearnerProgressSnapshot {
  userId: number;
  courseProgressPct: number;
  completedLessonCount: number;
  completedModuleCount: number;
  completedLabCount: number;
  quizPassCount: number;
  lastActivityAt: Date | null;
  currentStreakDays: number;
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

/** Per-question outcome inside a submitted attempt (F5-API-07 success). */
export interface QuestionResultDto {
  questionId: number;
  isCorrect: boolean;
  pointsEarned: number;
  explanation: string | null;
}

/** F5-API-07 success payload. */
export interface QuizAttemptResultDto {
  attemptId: number;
  score: number;
  isPassed: boolean;
  attemptNumber: number;
  correctCount: number;
  totalQuestions: number;
  breakdown: QuestionResultDto[];
}

/** Learner-safe quiz question (is_correct stripped; SCR-F5-02 rendering). */
export interface QuizQuestionDto {
  questionId: number;
  questionText: string;
  questionType: 'multiple_choice' | 'true_false' | 'fill_blank' | 'multiple_select';
  points: number;
  questionOrder: number;
  answers: Array<{
    answerId: number;
    answerText: string;
    answerOrder: number;
  }>;
}
