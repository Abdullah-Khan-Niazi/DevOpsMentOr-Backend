import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../../app/database';
import { academyCourses, lessons, modules } from '../../../app/database/schema';
import { logger } from '../../../shared/logger';
import {
  COURSE_SLUG_RE,
  formatItemSlug,
  formatModuleSlug,
} from '../../../shared/utils/curriculum-slug';

/** Transaction handle (same alias as the curriculum and labs repositories). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Item and module slugs are derived from position (C§11.1): module slug
 * `CxxMxx` from the course slug and `module_order`, item slug `CxxMxxLxx` from
 * the module slug and `lesson_order`. Items store their slug in `lessons.slug`;
 * modules have no column and are derived on read.
 */
export const curriculumSlugService = {
  /**
   * Recomputes every item slug of a course inside the caller's transaction.
   * Pass 1 clears the slugs so the global unique index on `lessons.slug` never
   * sees a collision while positions move; pass 2 writes the formatted slugs.
   * Skipped (with a warning) when the course slug is not `Cxx`.
   */
  async recomputeCourse(tx: Tx | typeof db, courseId: number): Promise<void> {
    const [course] = await tx
      .select({ slug: academyCourses.slug })
      .from(academyCourses)
      .where(eq(academyCourses.courseId, courseId))
      .limit(1);
    if (!course) {
      return;
    }
    if (!COURSE_SLUG_RE.test(course.slug)) {
      logger.warn(
        { courseId, courseSlug: course.slug },
        'Course slug is not in Cxx form; item slugs were not recomputed',
      );
      return;
    }

    const moduleRows = await tx
      .select({ moduleId: modules.moduleId, moduleOrder: modules.moduleOrder })
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(modules.moduleOrder));
    if (moduleRows.length === 0) {
      return;
    }

    const itemRows = await tx
      .select({
        lessonId: lessons.lessonId,
        moduleId: lessons.moduleId,
        lessonOrder: lessons.lessonOrder,
      })
      .from(lessons)
      .where(inArray(lessons.moduleId, moduleRows.map((row) => row.moduleId)))
      .orderBy(asc(lessons.lessonOrder), asc(lessons.lessonId));
    if (itemRows.length === 0) {
      return;
    }

    await tx
      .update(lessons)
      .set({ slug: null })
      .where(inArray(lessons.lessonId, itemRows.map((row) => row.lessonId)));

    // L = 1-based position inside the module (ties on lesson_order broken by id), so
    // gaps or duplicate orders never produce colliding slugs. A module whose order is
    // outside 1..99 or repeats another module's order keeps NULL item slugs (warned)
    // instead of aborting the caller's transaction.
    const seenModuleSlugs = new Set<string>();
    for (const moduleRow of moduleRows) {
      let moduleSlug: string;
      try {
        moduleSlug = formatModuleSlug(course.slug, moduleRow.moduleOrder);
      } catch {
        logger.warn({ courseId, moduleId: moduleRow.moduleId, moduleOrder: moduleRow.moduleOrder }, 'Module order is outside 1..99; item slugs left empty');
        continue;
      }
      if (seenModuleSlugs.has(moduleSlug)) {
        logger.warn({ courseId, moduleId: moduleRow.moduleId, moduleSlug }, 'Duplicate module order; item slugs left empty');
        continue;
      }
      seenModuleSlugs.add(moduleSlug);
      const items = itemRows.filter((row) => row.moduleId === moduleRow.moduleId);
      for (const [index, item] of items.entries()) {
        if (index >= 99) {
          logger.warn({ courseId, moduleId: moduleRow.moduleId, lessonId: item.lessonId }, 'Module has more than 99 items; item slug left empty');
          break;
        }
        await tx
          .update(lessons)
          .set({ slug: formatItemSlug(moduleSlug, index + 1) })
          .where(eq(lessons.lessonId, item.lessonId));
      }
    }
  },
};
