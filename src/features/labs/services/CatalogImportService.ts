import { and, asc, eq, max, ne, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../../app/database';
import {
  academyCourses,
  achievements,
  badges,
  categories,
  difficultyLevels,
  labs,
  lessons,
  modules,
  proLabs,
  trackContent,
  tracks,
} from '../../../app/database/schema';
import { ConflictError, ERROR_CODES, NotFoundError, ValidationError } from '../../../shared/errors';
import { formatModuleSlug } from '../../../shared/utils/curriculum-slug';
import { curriculumSlugService } from '../../curriculum/services/curriculum-slug.service';
import type { LabsCatalogExport, LabsManifest } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { labSpecV2Schema, toLabSpecIssues } from '../validators/lab-spec.validator';

/** Validated v2 spec as stored in `pro_labs.flag_values`. */
type StoredLabSpec = z.output<typeof labSpecV2Schema>;

/** Transaction handle (same alias as the labs repository). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Catalog difficulty -> `difficulty_levels.name` (code constant, not configuration). */
const LAB_DIFFICULTY_LEVEL: Partial<Record<string, string>> = {
  Easy: 'Beginner',
  Medium: 'Intermediate',
  Hard: 'Advanced',
};

/** Difficulty of every seeded course and track. */
const CURRICULUM_DIFFICULTY_LEVEL = 'Intermediate';

/** Lab network range written to every `pro_labs` row. */
const LAB_NETWORK_IP_RANGE = '172.17.0.0/16';

const ACHIEVEMENT_NAME_MAX = 100;

export interface CatalogImportOptions {
  activateNewLabs: boolean;
  createCurriculum: boolean;
  actorUserId: number | null;
}

export interface CatalogLabImportResult {
  labId: number;
  slug: string;
  created: boolean;
  stepCount: number;
}

export interface CatalogImportSummary {
  /** Null when the import ran with `createCurriculum: false` (labs only). */
  trackId: number | null;
  courses: number;
  modules: number;
  labs: CatalogLabImportResult[];
  achievements: number;
  badges: number;
}

type CatalogExport = LabsCatalogExport;
type CatalogCourse = CatalogExport['courses'][number];
type CatalogModule = CatalogCourse['modules'][number];

/** Validated import plan for one catalog module (lab item) with its parsed v2 spec. */
interface ModulePlan {
  module: CatalogModule;
  spec: StoredLabSpec;
}

interface CoursePlan {
  course: CatalogCourse;
  modules: ModulePlan[];
}

/**
 * Parses a manifest's lab spec into the stored `pro_labs.flag_values` v2 shape.
 * Runs before any write so an invalid lab never leaves a partial import.
 */
function buildLabSpec(manifest: LabsManifest): StoredLabSpec {
  const parsed = labSpecV2Schema.safeParse({
    version: 2,
    mode: manifest.mode,
    scenario: manifest.scenario,
    completionBonus: manifest.completionBonus,
    steps: manifest.steps,
  });
  if (!parsed.success) {
    throw new ValidationError(`The lab spec for ${manifest.slug} is invalid.`, [
      { code: ERROR_CODES.LAB_SPEC_INVALID },
      ...toLabSpecIssues(parsed.error),
    ]);
  }
  return parsed.data;
}

function truncateName(name: string): string {
  return name.length > ACHIEVEMENT_NAME_MAX ? name.slice(0, ACHIEVEMENT_NAME_MAX) : name;
}

async function findDifficultyId(tx: Tx, name: string): Promise<number> {
  const [row] = await tx
    .select({ difficultyId: difficultyLevels.difficultyId })
    .from(difficultyLevels)
    .where(eq(difficultyLevels.name, name))
    .limit(1);
  if (!row) {
    throw new ValidationError(`Difficulty level "${name}" is not seeded.`);
  }
  return row.difficultyId;
}

async function findCategoryId(tx: Tx, name: string): Promise<number | null> {
  if (name === '') {
    return null;
  }
  const [row] = await tx
    .select({ categoryId: categories.categoryId })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  return row?.categoryId ?? null;
}

/** Slug and title are unique across labs: another lab_id owning either is a conflict. */
async function assertLabIdentityFree(tx: Tx, manifest: LabsManifest): Promise<void> {
  const [slugOwner] = await tx
    .select({ labId: labs.labId })
    .from(labs)
    .where(and(eq(labs.slug, manifest.slug), ne(labs.labId, manifest.labId)))
    .limit(1);
  if (slugOwner) {
    throw new ConflictError(`The slug ${manifest.slug} is already used by another lab.`, [
      { code: ERROR_CODES.SLUG_TAKEN },
    ]);
  }
  const [nameOwner] = await tx
    .select({ labId: labs.labId })
    .from(labs)
    .where(and(eq(labs.labName, manifest.title), ne(labs.labId, manifest.labId)))
    .limit(1);
  if (nameOwner) {
    throw new ConflictError(`The title "${manifest.title}" is already used by another lab.`, [
      { code: ERROR_CODES.SLUG_TAKEN },
    ]);
  }
}

/**
 * Upserts one lab and its `pro_labs` row keyed by `labs.lab_id` (the manifest
 * labId). Existing rows keep `is_active` and `is_premium`.
 */
async function upsertLab(
  tx: Tx,
  manifest: LabsManifest,
  spec: StoredLabSpec,
  activateNewLabs: boolean,
): Promise<CatalogLabImportResult> {
  const difficultyName = LAB_DIFFICULTY_LEVEL[manifest.difficulty];
  if (!difficultyName) {
    throw new ValidationError(`Unknown lab difficulty "${manifest.difficulty}" in ${manifest.slug}.`);
  }
  const difficultyId = await findDifficultyId(tx, difficultyName);
  const categoryId = await findCategoryId(tx, manifest.category);
  await assertLabIdentityFree(tx, manifest);

  const labValues = {
    labName: manifest.title,
    slug: manifest.slug,
    description: manifest.description,
    difficultyId,
    categoryId,
    labType: 'pro_lab' as const,
    estimatedHours: Math.round(manifest.estimatedHours),
  };

  const [existing] = await tx
    .select({ labId: labs.labId })
    .from(labs)
    .where(eq(labs.labId, manifest.labId))
    .limit(1);
  if (existing) {
    await tx.update(labs).set(labValues).where(eq(labs.labId, manifest.labId));
  } else {
    await tx.insert(labs).values({
      labId: manifest.labId,
      ...labValues,
      isActive: activateNewLabs,
      isPremium: false,
    });
  }

  const proLabValues = {
    flagValues: spec,
    requiredRootCount: spec.steps.length,
    totalMachines: 1,
    networkIpRange: LAB_NETWORK_IP_RANGE,
  };
  const [existingProLab] = await tx
    .select({ proLabId: proLabs.proLabId })
    .from(proLabs)
    .where(eq(proLabs.labId, manifest.labId))
    .limit(1);
  if (existingProLab) {
    await tx.update(proLabs).set(proLabValues).where(eq(proLabs.labId, manifest.labId));
  } else {
    await tx.insert(proLabs).values({ labId: manifest.labId, ...proLabValues });
  }

  return {
    labId: manifest.labId,
    slug: manifest.slug,
    created: !existing,
    stepCount: spec.steps.length,
  };
}

/**
 * Keeps one track: upserts the catalog track by slug and deletes every other
 * track together with its track_content rows.
 */
async function upsertTrack(tx: Tx, track: CatalogExport['track'], difficultyId: number): Promise<number> {
  const [existing] = await tx
    .select({ trackId: tracks.trackId })
    .from(tracks)
    .where(eq(tracks.slug, track.slug))
    .limit(1);

  if (existing) {
    await tx.delete(trackContent).where(ne(trackContent.trackId, existing.trackId));
    await tx.delete(tracks).where(ne(tracks.trackId, existing.trackId));
    await tx
      .update(tracks)
      .set({ trackName: track.trackName, description: track.description, difficultyId, isActive: true })
      .where(eq(tracks.trackId, existing.trackId));
    return existing.trackId;
  }

  await tx.delete(trackContent);
  await tx.delete(tracks);
  const inserted = await tx.insert(tracks).values({
    trackName: track.trackName,
    slug: track.slug,
    description: track.description,
    difficultyId,
    isActive: true,
  });
  const trackId = inserted[0]?.insertId;
  if (!trackId) {
    throw new Error('Failed to create the catalog track.');
  }
  return trackId;
}

/** Upserts a course keyed by its slug. `is_published` = the course has at least one module. */
async function upsertCourse(
  tx: Tx,
  course: CatalogCourse,
  values: { difficultyId: number; estimatedHours: number; isPublished: boolean },
  actorUserId: number | null,
): Promise<number> {
  const [existing] = await tx
    .select({ courseId: academyCourses.courseId })
    .from(academyCourses)
    .where(eq(academyCourses.slug, course.slug))
    .limit(1);
  const courseValues = {
    title: course.title,
    description: course.description,
    // Combined slide deck R2 key (null when the course has none); presigned on demand by SlidesService.
    videoTrailerUrl: course.slidesKey,
    difficultyId: values.difficultyId,
    estimatedHours: values.estimatedHours,
    isPublished: values.isPublished,
  };
  if (existing) {
    await tx.update(academyCourses).set(courseValues).where(eq(academyCourses.courseId, existing.courseId));
    return existing.courseId;
  }
  if (actorUserId === null) {
    throw new ValidationError('An acting user is required to create courses.');
  }
  const inserted = await tx.insert(academyCourses).values({
    ...courseValues,
    slug: course.slug,
    instructorId: actorUserId,
  });
  const courseId = inserted[0]?.insertId;
  if (!courseId) {
    throw new Error(`Failed to create course ${course.slug}.`);
  }
  return courseId;
}

/** Upserts a module keyed by (courseId, module_order). */
async function upsertModule(tx: Tx, courseId: number, module: CatalogModule): Promise<number> {
  const [existing] = await tx
    .select({ moduleId: modules.moduleId })
    .from(modules)
    .where(and(eq(modules.courseId, courseId), eq(modules.moduleOrder, module.order)))
    .limit(1);
  const moduleValues = {
    title: module.moduleTitle,
    description: module.lab.description,
    estimatedMinutes: Math.round(module.lab.estimatedHours * 60),
    isPublished: true,
  };
  if (existing) {
    await tx.update(modules).set(moduleValues).where(eq(modules.moduleId, existing.moduleId));
    return existing.moduleId;
  }
  const inserted = await tx.insert(modules).values({ ...moduleValues, courseId, moduleOrder: module.order });
  const moduleId = inserted[0]?.insertId;
  if (!moduleId) {
    throw new Error(`Failed to create module ${module.slug}.`);
  }
  return moduleId;
}

/**
 * Upserts the catalog lab item of a module keyed by (module, lab). Item slugs are
 * positional and change on reorder, so they are not a stable key: keying by slug
 * would turn a staff item that moved into position 01 into the lab item. An
 * existing item keeps its position; a new one goes first in an empty module and
 * last otherwise. The caller recomputes the course's item slugs afterwards.
 */
async function upsertLabItem(tx: Tx, moduleId: number, manifest: LabsManifest, labId: number): Promise<void> {
  const [existing] = await tx
    .select({ lessonId: lessons.lessonId })
    .from(lessons)
    .where(and(eq(lessons.moduleId, moduleId), eq(lessons.contentType, 'lab'), eq(lessons.labId, labId)))
    .orderBy(asc(lessons.lessonOrder))
    .limit(1);
  if (existing) {
    await tx
      .update(lessons)
      .set({ title: manifest.title, content: null, isPublished: true })
      .where(eq(lessons.lessonId, existing.lessonId));
    return;
  }
  const [last] = await tx
    .select({ value: max(lessons.lessonOrder) })
    .from(lessons)
    .where(eq(lessons.moduleId, moduleId));
  await tx.insert(lessons).values({
    moduleId,
    title: manifest.title,
    contentType: 'lab',
    labId,
    content: null,
    lessonOrder: (last?.value ?? 0) + 1,
    isPublished: true,
    slug: null,
  });
}

/** Upserts an achievement keyed by its unique name. */
async function upsertAchievement(
  tx: Tx,
  values: {
    name: string;
    description: string;
    pointsAwarded: number;
    triggerType: string;
    triggerValue: Record<string, unknown>;
  },
): Promise<void> {
  const name = truncateName(values.name);
  const achievementValues = {
    description: values.description,
    pointsAwarded: values.pointsAwarded,
    triggerType: values.triggerType,
    triggerValue: values.triggerValue,
    isActive: true,
  };
  const [existing] = await tx
    .select({ achievementId: achievements.achievementId })
    .from(achievements)
    .where(eq(achievements.name, name))
    .limit(1);
  if (existing) {
    await tx.update(achievements).set(achievementValues).where(eq(achievements.achievementId, existing.achievementId));
    return;
  }
  await tx.insert(achievements).values({ ...achievementValues, name });
}

/** Upserts a badge keyed by its slug. */
async function upsertBadge(
  tx: Tx,
  values: {
    slug: string;
    name: string;
    description: string;
    criteria: { triggerType: string; triggerValue: Record<string, unknown> };
  },
): Promise<void> {
  const badgeValues = {
    badgeName: values.name,
    description: values.description,
    criteria: values.criteria,
    pointsRequired: 0,
    isHidden: false,
  };
  const [existing] = await tx
    .select({ badgeId: badges.badgeId })
    .from(badges)
    .where(eq(badges.slug, values.slug))
    .limit(1);
  if (existing) {
    await tx.update(badges).set(badgeValues).where(eq(badges.badgeId, existing.badgeId));
    return;
  }
  await tx.insert(badges).values({ ...badgeValues, slug: values.slug });
}

/** Keeps the course attachments of the track in catalog order and drops stale course rows. */
async function syncTrackCourses(
  tx: Tx,
  trackId: number,
  entries: Array<{ courseId: number; displayOrder: number }>,
): Promise<void> {
  for (const entry of entries) {
    await tx
      .insert(trackContent)
      .values({
        trackId,
        contentType: 'course',
        contentId: entry.courseId,
        displayOrder: entry.displayOrder,
        required: true,
      })
      .onDuplicateKeyUpdate({ set: { displayOrder: entry.displayOrder, required: true } });
  }
  const courseIds = entries.map((entry) => entry.courseId);
  await tx
    .delete(trackContent)
    .where(
      and(
        eq(trackContent.trackId, trackId),
        eq(trackContent.contentType, 'course'),
        courseIds.length > 0 ? notInArray(trackContent.contentId, courseIds) : undefined,
      ),
    );
}

/**
 * Catalog import (C§2.4 / 2.5 / 11.3). Labs are the only source of lab content:
 * the manifests come from the Labs catalog endpoints, and the backend keeps no copy.
 */
export class CatalogImportService {
  /** One lab: `GET /catalog/labs/:slug` then one transaction. */
  async importLab(
    slug: string,
    opts: Pick<CatalogImportOptions, 'activateNewLabs'>,
  ): Promise<CatalogLabImportResult> {
    const manifest = await containerOrchestrationAdapter.getCatalogLab(slug);
    if (!manifest) {
      throw new NotFoundError('Lab not found in the catalog.', [{ code: ERROR_CODES.CATALOG_LAB_NOT_FOUND }]);
    }
    const spec = buildLabSpec(manifest);
    return db.transaction((tx) => upsertLab(tx, manifest, spec, opts.activateNewLabs));
  }

  /** Whole catalog: track, courses, modules, lab items, labs, achievements and badges in one transaction. */
  async importAll(opts: CatalogImportOptions): Promise<CatalogImportSummary> {
    const catalog = await containerOrchestrationAdapter.getCatalogExport();
    const plans: CoursePlan[] = catalog.courses.map((course) => ({
      course,
      modules: course.modules.map((module) => {
        if (module.slug !== formatModuleSlug(course.slug, module.order)) {
          throw new ValidationError(`Module ${module.slug} does not match its position in ${course.slug}.`);
        }
        if (module.lab.courseSlug !== course.slug || module.lab.moduleSlug !== module.slug) {
          throw new ValidationError(`Lab ${module.lab.slug} is not placed in ${module.slug}.`);
        }
        return { module, spec: buildLabSpec(module.lab) };
      }),
    }));

    return db.transaction(async (tx) => {
      const labResults: CatalogLabImportResult[] = [];
      let achievementCount = 0;
      let badgeCount = 0;
      let moduleCount = 0;

      if (!opts.createCurriculum) {
        for (const plan of plans) {
          for (const { module, spec } of plan.modules) {
            labResults.push(await upsertLab(tx, module.lab, spec, opts.activateNewLabs));
          }
        }
        return {
          trackId: null,
          courses: 0,
          modules: 0,
          labs: labResults,
          achievements: 0,
          badges: 0,
        };
      }

      const difficultyId = await findDifficultyId(tx, CURRICULUM_DIFFICULTY_LEVEL);
      const trackId = await upsertTrack(tx, catalog.track, difficultyId);

      for (const milestone of catalog.track.milestones) {
        await upsertAchievement(tx, {
          name: milestone.name,
          description: milestone.description,
          pointsAwarded: milestone.points,
          triggerType: milestone.triggerType,
          triggerValue: { count: milestone.count },
        });
        achievementCount += 1;
      }

      const trackEntries: Array<{ courseId: number; displayOrder: number }> = [];
      for (const plan of plans) {
        const { course } = plan;
        const estimatedHours = Math.round(
          plan.modules.reduce((total, entry) => total + entry.module.lab.estimatedHours, 0),
        );
        const courseId = await upsertCourse(
          tx,
          course,
          {
            difficultyId,
            estimatedHours,
            isPublished: plan.modules.length > 0,
          },
          opts.actorUserId,
        );
        trackEntries.push({ courseId, displayOrder: course.order });

        for (const { module, spec } of plan.modules) {
          const labResult = await upsertLab(tx, module.lab, spec, opts.activateNewLabs);
          labResults.push(labResult);
          const moduleId = await upsertModule(tx, courseId, module);
          moduleCount += 1;
          await upsertLabItem(tx, moduleId, module.lab, labResult.labId);

          await upsertAchievement(tx, {
            name: `${module.slug} ${module.moduleTitle}`,
            description: `Completed the ${module.moduleTitle} module.`,
            pointsAwarded: course.rewards.moduleCompletePoints,
            triggerType: 'module_complete',
            triggerValue: { moduleId },
          });
          achievementCount += 1;
        }

        // Positional item slugs (C§11.1): the catalog lab in position 01 gets `CxxMxxL01`.
        await curriculumSlugService.recomputeCourse(tx, courseId);

        await upsertAchievement(tx, {
          name: `${course.slug} ${course.title} Complete`,
          description: `Completed every module of ${course.title}.`,
          pointsAwarded: course.rewards.courseCompletePoints,
          triggerType: 'course_complete',
          triggerValue: { courseId },
        });
        achievementCount += 1;

        await upsertBadge(tx, {
          slug: course.rewards.badge.slug,
          name: course.rewards.badge.name,
          description: course.rewards.badge.description,
          criteria: { triggerType: 'course_complete', triggerValue: { courseId } },
        });
        badgeCount += 1;
      }

      await syncTrackCourses(tx, trackId, trackEntries);

      return {
        trackId,
        courses: plans.length,
        modules: moduleCount,
        labs: labResults,
        achievements: achievementCount,
        badges: badgeCount,
      };
    });
  }
}

export const catalogImportService = new CatalogImportService();
