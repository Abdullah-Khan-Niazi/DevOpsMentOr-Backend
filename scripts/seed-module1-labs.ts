import dotenv from 'dotenv';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  academyCourses,
  certificates,
  classAssignments,
  db,
  disconnectDatabase,
  lessons,
  modules,
  permissions,
  pointsHistory,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  rolePermissions,
  roles,
  systemSettings,
  trackContent,
  tracks,
  userProgress,
  userQuizAnswers,
  userRoles,
  vpnServers,
} from '../src/app/database';
import { escapeLike } from '../src/features/gamification/config/award-keys';
import { catalogImportService } from '../src/features/labs/services/CatalogImportService';
import { PERMISSIONS, ROLES } from '../src/shared/constants';

dotenv.config();

/**
 * Non-destructive curriculum reseed for an existing database (run after
 * `npm run db:seed`, or on its own to refresh lab content):
 *
 *   npx tsx scripts/seed-module1-labs.ts [--reset-progress]
 *
 * The Labs app is the single source of lab content: this script fetches
 * `GET /catalog/export` from CONTAINER_ORCHESTRATION_API_URL and imports
 * 1 track, 15 courses, their modules, 1 lab item per module, the labs
 * (`pro_labs.flag_values` v2) and the achievements/badges from course.json.
 * No quizzes or lessons are seeded. Legacy (non C<NN>) courses, their
 * quizzes/lessons, other tracks and `gamification` system settings are purged.
 * Users, running lab environments and the points ledger are kept;
 * `--reset-progress` also removes ledger rows keyed on lesson/module/course/quiz ids.
 */

const TRACK_SLUG = 'devops-engineering-track';
const COURSE_SLUG_PATTERN = '^C[0-9]{2}$';

/** Ledger key kinds whose ids are rebuilt by a reseed (removed with --reset-progress). */
const RESEED_LEDGER_KINDS = ['lesson', 'module', 'course', 'quiz_pass', 'quiz_wrong', 'quiz_guess'] as const;

async function ensureLearnerLabPermissions(): Promise<void> {
  const learnerRole = await db.query.roles.findFirst({
    where: eq(roles.roleName, ROLES.INDIVIDUAL_LEARNER),
  });
  if (!learnerRole) {
    console.warn(`Role ${ROLES.INDIVIDUAL_LEARNER} not found; skipped lab permission check.`);
    return;
  }

  const labPermNames = [
    PERMISSIONS.LABS_INSTANCE_CREATE,
    PERMISSIONS.LABS_INSTANCE_READ,
    PERMISSIONS.LABS_INSTANCE_DELETE,
    PERMISSIONS.LABS_AI_MENTOR_USE,
  ];

  const permRows = await db
    .select()
    .from(permissions)
    .where(inArray(permissions.permissionName, labPermNames));
  if (permRows.length !== labPermNames.length) {
    const found = new Set(permRows.map((row) => row.permissionName));
    console.warn(`Missing lab permissions: ${labPermNames.filter((name) => !found.has(name)).join(', ')}.`);
  }

  for (const perm of permRows) {
    const existing = await db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, learnerRole.roleId),
          eq(rolePermissions.permissionId, perm.permissionId),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      await db.insert(rolePermissions).values({
        roleId: learnerRole.roleId,
        permissionId: perm.permissionId,
      });
    }
  }
  console.log('Verified lab permissions for individual_learner role.');
}

async function seedVpnPool(): Promise<void> {
  const regions: Array<{ name: string; location: string; region: 'US' | 'EU' | 'ASIA'; ip: string }> = [
    { name: 'dm-vpn-us-east-1', location: 'Virginia, US', region: 'US', ip: '10.10.1.1' },
    { name: 'dm-vpn-eu-central-1', location: 'Frankfurt, EU', region: 'EU', ip: '10.10.2.1' },
    { name: 'dm-vpn-ap-south-1', location: 'Singapore, ASIA', region: 'ASIA', ip: '10.10.3.1' },
  ];

  for (const r of regions) {
    const existing = await db
      .select()
      .from(vpnServers)
      .where(eq(vpnServers.serverName, r.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(vpnServers).values({
        serverName: r.name,
        serverLocation: r.location,
        ipAddress: r.ip,
        port: 443,
        region: r.region,
        maxUsers: 500,
        currentUsers: 0,
        isActive: true,
        isMaintenance: false,
        status: 'online',
      });
    } else {
      await db
        .update(vpnServers)
        .set({
          isActive: true,
          isMaintenance: false,
          status: 'online',
          maxUsers: 500,
          currentUsers: 0,
        })
        .where(eq(vpnServers.vpnId, existing[0].vpnId));
    }
  }
  console.log('Seeded and reset online VPN server pool (US, EU, ASIA).');
}

/** First platform admin, used as instructor if the course has to be created. */
async function resolveInstructorId(): Promise<number> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.roleId, userRoles.roleId))
    .where(eq(roles.roleName, ROLES.PLATFORM_ADMIN))
    .orderBy(asc(userRoles.userId))
    .limit(1);
  const userId = rows[0]?.userId;
  if (!userId) {
    throw new Error('No platform admin user exists. Run npm run db:seed first.');
  }
  return userId;
}

/**
 * Removes the pre-catalog curriculum (courses whose slug is not `C<NN>`, with
 * every dependent row, other tracks, gamification settings) in one transaction,
 * children first, with foreign-key checks on.
 */
export async function purgeLegacyCurriculum(): Promise<void> {
  await db.transaction(async (tx) => {
    const legacyCourses = (
      await tx
        .select({ courseId: academyCourses.courseId })
        .from(academyCourses)
        .where(sql`${academyCourses.slug} NOT REGEXP ${COURSE_SLUG_PATTERN}`)
    ).map((row) => row.courseId);

    if (legacyCourses.length > 0) {
      const moduleIds = (
        await tx.select({ moduleId: modules.moduleId }).from(modules).where(inArray(modules.courseId, legacyCourses))
      ).map((row) => row.moduleId);
      const quizIds = moduleIds.length
        ? (await tx.select({ quizId: quizzes.quizId }).from(quizzes).where(inArray(quizzes.moduleId, moduleIds))).map(
            (row) => row.quizId,
          )
        : [];
      const questionIds = quizIds.length
        ? (
            await tx
              .select({ questionId: quizQuestions.questionId })
              .from(quizQuestions)
              .where(inArray(quizQuestions.quizId, quizIds))
          ).map((row) => row.questionId)
        : [];

      if (quizIds.length > 0) {
        const attemptIds = (
          await tx.select({ attemptId: quizAttempts.attemptId }).from(quizAttempts).where(inArray(quizAttempts.quizId, quizIds))
        ).map((row) => row.attemptId);
        if (attemptIds.length > 0) {
          await tx.delete(userQuizAnswers).where(inArray(userQuizAnswers.attemptId, attemptIds));
        }
        if (questionIds.length > 0) {
          await tx.delete(userQuizAnswers).where(inArray(userQuizAnswers.questionId, questionIds));
          await tx.delete(quizAnswers).where(inArray(quizAnswers.questionId, questionIds));
        }
        await tx.delete(quizAttempts).where(inArray(quizAttempts.quizId, quizIds));
        await tx.delete(quizQuestions).where(inArray(quizQuestions.quizId, quizIds));
      }

      await tx.delete(userProgress).where(inArray(userProgress.courseId, legacyCourses));
      if (moduleIds.length > 0) {
        await tx.delete(userProgress).where(inArray(userProgress.moduleId, moduleIds));
        await tx.delete(lessons).where(inArray(lessons.moduleId, moduleIds));
      }
      if (quizIds.length > 0) await tx.delete(quizzes).where(inArray(quizzes.quizId, quizIds));
      if (moduleIds.length > 0) await tx.delete(modules).where(inArray(modules.moduleId, moduleIds));
      await tx.delete(classAssignments).where(inArray(classAssignments.courseId, legacyCourses));
      await tx.delete(certificates).where(inArray(certificates.courseId, legacyCourses));
      await tx
        .delete(trackContent)
        .where(and(eq(trackContent.contentType, 'course'), inArray(trackContent.contentId, legacyCourses)));
      await tx.delete(academyCourses).where(inArray(academyCourses.courseId, legacyCourses));
    }

    const otherTracks = (
      await tx.select({ trackId: tracks.trackId }).from(tracks).where(sql`${tracks.slug} <> ${TRACK_SLUG}`)
    ).map((row) => row.trackId);
    if (otherTracks.length > 0) {
      await tx.delete(trackContent).where(inArray(trackContent.trackId, otherTracks));
      await tx.delete(tracks).where(inArray(tracks.trackId, otherTracks));
    }

    await tx.delete(systemSettings).where(eq(systemSettings.groupName, 'gamification'));
    console.log(
      `Purged ${legacyCourses.length} legacy course(s), ${otherTracks.length} other track(s) and gamification settings.`,
    );
  });
}

/** Dev-only reset: deletes ledger rows keyed on rebuilt ids and recomputes running balances. */
async function resetRebuiltLedger(): Promise<number> {
  return db.transaction(async (tx) => {
    const conditions = RESEED_LEDGER_KINDS.map(
      (kind) =>
        sql`${pointsHistory.description} COLLATE utf8mb4_bin LIKE ${`${escapeLike(`[k:${kind}:`)}%`} ESCAPE '!'`,
    );
    const affected = await tx
      .selectDistinct({ userId: pointsHistory.userId })
      .from(pointsHistory)
      .where(or(...conditions));
    if (affected.length === 0) return 0;

    const result = await tx.delete(pointsHistory).where(or(...conditions));
    const remaining = await tx
      .select({
        historyId: pointsHistory.historyId,
        userId: pointsHistory.userId,
        pointsChange: pointsHistory.pointsChange,
        pointsBalanceAfter: pointsHistory.pointsBalanceAfter,
      })
      .from(pointsHistory)
      .where(inArray(pointsHistory.userId, affected.map((row) => row.userId)))
      .orderBy(asc(pointsHistory.userId), asc(pointsHistory.historyId));
    const running = new Map<number, number>();
    for (const row of remaining) {
      const balance = (running.get(row.userId) ?? 0) + row.pointsChange;
      running.set(row.userId, balance);
      if (balance !== row.pointsBalanceAfter) {
        await tx.update(pointsHistory).set({ pointsBalanceAfter: balance }).where(eq(pointsHistory.historyId, row.historyId));
      }
    }
    return result[0].affectedRows;
  });
}

/** Purge legacy rows, then import the whole Labs catalog (shared with seed.ts). */
export async function importCatalogCurriculum(actorUserId: number): Promise<void> {
  await purgeLegacyCurriculum();
  try {
    const summary = await catalogImportService.importAll({
      activateNewLabs: true,
      createCurriculum: true,
      actorUserId,
    });
    console.log(
      `Catalog import complete: track ${summary.trackId}, ${summary.courses} courses, ${summary.modules} modules, ` +
        `${summary.labs.length} labs, ${summary.achievements} achievements, ${summary.badges} badges.`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Catalog import failed. Is the Labs app reachable at CONTAINER_ORCHESTRATION_API_URL? (${reason})`,
    );
  }
}

async function main(): Promise<void> {
  const resetProgress = process.argv.includes('--reset-progress');

  await ensureLearnerLabPermissions();
  await seedVpnPool();

  if (resetProgress) {
    const removed = await resetRebuiltLedger();
    console.log(`Removed ${removed} ledger rows keyed on rebuilt curriculum ids (--reset-progress).`);
  }
  await importCatalogCurriculum(await resolveInstructorId());
  console.log('Curriculum seeding complete.');
}

if (require.main === module) {
  main()
    .catch((err: unknown) => {
      console.error('Error seeding curriculum and labs:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDatabase();
    });
}
