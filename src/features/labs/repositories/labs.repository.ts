import { and, asc, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '../../../app/database';
import {
  activityLogs,
  categories,
  difficultyLevels,
  labs,
  lessons,
  proLabs,
  pwnboxInstances,
  sherlocks,
  trackContent,
  tracks,
  users,
  vpnAssignments,
  vpnServers,
} from '../../../app/database/schema';
import type { LabInstanceStatus, LabType, TrackContentType, VpnRegion } from '../dto/labs.dto';

/** Lab row joined to difficulty/category names. */
export interface LabRow {
  labId: number;
  labName: string;
  slug: string;
  description: string | null;
  difficultyId: number;
  difficultyName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  labType: LabType;
  isActive: boolean;
  isPremium: boolean;
  estimatedHours: number;
  networkDiagramUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Pro-lab extension row. */
export interface ProLabRow {
  proLabId: number;
  labId: number;
  networkIpRange: string | null;
  totalMachines: number;
  requiredRootCount: number;
  flagValues: Record<string, string> | null;
  activeUsersCount: number;
}

/** Sherlock extension row. `answers` is server-side only. */
export interface SherlockRow {
  sherlockId: number;
  labId: number;
  evidenceFileUrl: string | null;
  evidenceFileSize: number | null;
  fileHash: string | null;
  questions: Array<{ id: string; text: string; hint?: string }> | null;
  answers: Array<{ id: string; answer: string }> | null;
  requiredCorrectAnswers: number;
}

/**
 * Instance row. `labId` and `labType` are recovered from the LAB_STARTED
 * activity event (the SQL table carries no lab column; F6 §06).
 */
export interface InstanceRow {
  instanceId: number;
  userId: number;
  vpnId: number;
  labId: number | null;
  labType: LabType | null;
  hostname: string | null;
  assignedIp: string | null;
  sshPort: number;
  rootPassword: string | null;
  ramGb: number;
  cpuCores: number;
  diskGb: number;
  status: LabInstanceStatus;
  startedAt: Date;
  expiresAt: Date | null;
  terminatedAt: Date | null;
}

export interface InstanceInsertInput {
  userId: number;
  vpnId: number;
  hostname: string | null;
  assignedIp: string | null;
  sshPort: number;
  rootPassword: string | null;
  ramGb: number;
  cpuCores: number;
  diskGb: number;
  status: 'pending' | 'running';
  expiresAt: Date;
}

export interface VpnServerRow {
  vpnId: number;
  serverName: string;
  serverLocation: string | null;
  region: VpnRegion;
  maxUsers: number;
  currentUsers: number;
}

export interface VpnAssignmentRow {
  assignmentId: number;
  userId: number;
  vpnId: number;
  assignedIp: string | null;
  ovpnConfigUrl: string | null;
  assignedAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
}

export interface TrackRow {
  trackId: number;
  trackName: string;
  slug: string;
  description: string | null;
  difficultyId: number;
  difficultyName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  totalLabs: number;
  isActive: boolean;
  isPremium: boolean;
  createdAt: Date;
}

export interface TrackContentRow {
  trackId: number;
  contentType: TrackContentType;
  contentId: number;
  displayOrder: number;
  required: boolean;
  title: string;
}

export interface TrackContentInput {
  contentType: TrackContentType;
  contentId: number;
  displayOrder: number;
  required: boolean;
}

export interface AdminInstanceRow extends InstanceRow {
  labName: string | null;
  username: string | null;
}

/** Row shape produced by `instanceSelect()` (join with the LAB_STARTED event). */
interface InstanceSelectRow {
  instanceId: number;
  userId: number;
  vpnId: number;
  labId: number | null;
  labType: LabType | null;
  hostname: string | null;
  assignedIp: string | null;
  sshPort: number;
  rootPassword: string | null;
  ramGb: number;
  cpuCores: number;
  diskGb: number;
  status: LabInstanceStatus;
  startedAt: Date;
  expiresAt: Date | null;
  terminatedAt: Date | null;
}

/** Joins an instance to its LAB_STARTED activity event to recover the lab. */
function labEventJoin() {
  return and(
    eq(activityLogs.userId, pwnboxInstances.userId),
    eq(activityLogs.activityType, 'LAB_STARTED'),
    sql`json_extract(${activityLogs.details}, '$.instanceId') = ${pwnboxInstances.instanceId}`,
  );
}

const derivedLabId = sql<number | null>`json_extract(${activityLogs.details}, '$.labId')`;
const derivedLabType = sql<LabType | null>`json_extract(${activityLogs.details}, '$.labType')`;

/**
 * F6 §08 data access. Every learner-scoped query pins `user_id = session
 * userId` (IDOR/BOLA mitigation): instance, assignment and activity lookups
 * are scoped at the SQL level.
 */
export class LabsRepository {
  /* ── Lab catalog ─────────────────────────────────────────────────────── */

  async findLabById(labId: number): Promise<LabRow | null> {
    const rows = await db
      .select({
        labId: labs.labId,
        labName: labs.labName,
        slug: labs.slug,
        description: labs.description,
        difficultyId: labs.difficultyId,
        difficultyName: difficultyLevels.name,
        categoryId: labs.categoryId,
        categoryName: categories.name,
        labType: labs.labType,
        isActive: labs.isActive,
        isPremium: labs.isPremium,
        estimatedHours: labs.estimatedHours,
        networkDiagramUrl: labs.networkDiagramUrl,
        createdAt: labs.createdAt,
        updatedAt: labs.updatedAt,
      })
      .from(labs)
      .leftJoin(difficultyLevels, eq(labs.difficultyId, difficultyLevels.difficultyId))
      .leftJoin(categories, eq(labs.categoryId, categories.categoryId))
      .where(eq(labs.labId, labId))
      .limit(1);
    return this.toLabRow(rows[0]);
  }

  async findLabBySlug(slug: string): Promise<LabRow | null> {
    const rows = await db
      .select({
        labId: labs.labId,
        labName: labs.labName,
        slug: labs.slug,
        description: labs.description,
        difficultyId: labs.difficultyId,
        difficultyName: difficultyLevels.name,
        categoryId: labs.categoryId,
        categoryName: categories.name,
        labType: labs.labType,
        isActive: labs.isActive,
        isPremium: labs.isPremium,
        estimatedHours: labs.estimatedHours,
        networkDiagramUrl: labs.networkDiagramUrl,
        createdAt: labs.createdAt,
        updatedAt: labs.updatedAt,
      })
      .from(labs)
      .leftJoin(difficultyLevels, eq(labs.difficultyId, difficultyLevels.difficultyId))
      .leftJoin(categories, eq(labs.categoryId, categories.categoryId))
      .where(eq(labs.slug, slug))
      .limit(1);
    return this.toLabRow(rows[0]);
  }

  async listLabs(includeInactive: boolean): Promise<LabRow[]> {
    const rows = await db
      .select({
        labId: labs.labId,
        labName: labs.labName,
        slug: labs.slug,
        description: labs.description,
        difficultyId: labs.difficultyId,
        difficultyName: difficultyLevels.name,
        categoryId: labs.categoryId,
        categoryName: categories.name,
        labType: labs.labType,
        isActive: labs.isActive,
        isPremium: labs.isPremium,
        estimatedHours: labs.estimatedHours,
        networkDiagramUrl: labs.networkDiagramUrl,
        createdAt: labs.createdAt,
        updatedAt: labs.updatedAt,
      })
      .from(labs)
      .leftJoin(difficultyLevels, eq(labs.difficultyId, difficultyLevels.difficultyId))
      .leftJoin(categories, eq(labs.categoryId, categories.categoryId))
      .where(includeInactive ? undefined : eq(labs.isActive, true))
      .orderBy(asc(labs.labName));
    return rows
      .map((row) => this.toLabRow(row))
      .filter((row): row is LabRow => row !== null);
  }

  /* ── Lab extensions ───────────────────────────────────────────────────── */

  async findProLabByLabId(labId: number): Promise<ProLabRow | null> {
    const rows = await db
      .select()
      .from(proLabs)
      .where(eq(proLabs.labId, labId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findSherlockByLabId(labId: number): Promise<SherlockRow | null> {
    const rows = await db
      .select()
      .from(sherlocks)
      .where(eq(sherlocks.labId, labId))
      .limit(1);
    return rows[0] ?? null;
  }

  async insertProLab(input: {
    labId: number;
    networkIpRange: string | null;
    totalMachines: number;
    requiredRootCount: number;
    flagValues: Record<string, string> | null;
  }): Promise<number> {
    const inserted = await db.insert(proLabs).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create pro_lab configuration.');
    }
    return id;
  }

  async insertSherlock(input: {
    labId: number;
    evidenceFileUrl: string | null;
    evidenceFileSize: number | null;
    fileHash: string | null;
    questions: Array<{ id: string; text: string; hint?: string }>;
    answers: Array<{ id: string; answer: string }>;
    requiredCorrectAnswers: number;
  }): Promise<number> {
    const inserted = await db.insert(sherlocks).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create sherlock configuration.');
    }
    return id;
  }

  async updateProLab(
    labId: number,
    patch: {
      networkIpRange?: string | null;
      totalMachines?: number;
      requiredRootCount?: number;
      flagValues?: Record<string, string> | null;
    },
  ): Promise<void> {
    await db.update(proLabs).set(patch).where(eq(proLabs.labId, labId));
  }

  async updateSherlock(
    labId: number,
    patch: {
      evidenceFileUrl?: string | null;
      evidenceFileSize?: number | null;
      fileHash?: string | null;
      questions?: Array<{ id: string; text: string; hint?: string }>;
      answers?: Array<{ id: string; answer: string }>;
      requiredCorrectAnswers?: number;
    },
  ): Promise<void> {
    await db.update(sherlocks).set(patch).where(eq(sherlocks.labId, labId));
  }

  async insertLab(input: {
    labName: string;
    slug: string;
    description: string | null;
    difficultyId: number;
    categoryId: number | null;
    labType: LabType;
    isPremium: boolean;
    estimatedHours: number;
    networkDiagramUrl: string | null;
  }): Promise<number> {
    const inserted = await db.insert(labs).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create lab.');
    }
    return id;
  }

  async updateLab(
    labId: number,
    patch: {
      labName?: string;
      slug?: string;
      description?: string | null;
      difficultyId?: number;
      categoryId?: number | null;
      isPremium?: boolean;
      estimatedHours?: number;
      networkDiagramUrl?: string | null;
    },
  ): Promise<void> {
    await db.update(labs).set(patch).where(eq(labs.labId, labId));
  }

  async setLabActive(labId: number, isActive: boolean): Promise<void> {
    await db.update(labs).set({ isActive }).where(eq(labs.labId, labId));
  }

  /* ── pwnbox_instances ─────────────────────────────────────────────────── */

  /** Active instance for a user (invariant 1: at most one running). */
  async findActiveInstanceForUser(userId: number, labId: number): Promise<InstanceRow | null> {
    const rows = await db
      .select(this.instanceSelect())
      .from(pwnboxInstances)
      .leftJoin(activityLogs, labEventJoin())
      .where(
        and(
          eq(pwnboxInstances.userId, userId),
          sql`json_extract(${activityLogs.details}, '$.labId') = ${labId}`,
          inArray(pwnboxInstances.status, ['pending', 'running', 'stopped']),
        ),
      )
      .orderBy(desc(pwnboxInstances.instanceId))
      .limit(1);
    return this.toInstanceRow(rows[0]);
  }

  /** Any live instance for a user (across all labs). */
  async findAnyActiveInstanceForUser(userId: number): Promise<InstanceRow | null> {
    const rows = await db
      .select(this.instanceSelect())
      .from(pwnboxInstances)
      .leftJoin(activityLogs, labEventJoin())
      .where(
        and(
          eq(pwnboxInstances.userId, userId),
          inArray(pwnboxInstances.status, ['pending', 'running', 'stopped']),
        ),
      )
      .orderBy(desc(pwnboxInstances.instanceId))
      .limit(1);
    return this.toInstanceRow(rows[0]);
  }

  /** Ownership-scoped instance lookup (IDOR mitigation). */
  async findInstanceForUser(userId: number, instanceId: number): Promise<InstanceRow | null> {
    const rows = await db
      .select(this.instanceSelect())
      .from(pwnboxInstances)
      .leftJoin(activityLogs, labEventJoin())
      .where(and(eq(pwnboxInstances.instanceId, instanceId), eq(pwnboxInstances.userId, userId)))
      .limit(1);
    return this.toInstanceRow(rows[0]);
  }

  /** Admin-only unscoped lookup. */
  async findInstanceById(instanceId: number): Promise<InstanceRow | null> {
    const rows = await db
      .select(this.instanceSelect())
      .from(pwnboxInstances)
      .leftJoin(activityLogs, labEventJoin())
      .where(eq(pwnboxInstances.instanceId, instanceId))
      .limit(1);
    return this.toInstanceRow(rows[0]);
  }

  async insertInstance(input: InstanceInsertInput): Promise<number> {
    const inserted = await db.insert(pwnboxInstances).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create lab instance.');
    }
    return id;
  }

  async updateInstanceStatus(instanceId: number, status: LabInstanceStatus): Promise<void> {
    const patch: Record<string, unknown> = { status };
    if (status === 'terminated') {
      patch.terminatedAt = new Date();
    }
    if (status === 'running') {
      patch.startedAt = new Date();
    }
    await db.update(pwnboxInstances).set(patch).where(eq(pwnboxInstances.instanceId, instanceId));
  }

  async updateInstanceExpiry(instanceId: number, expiresAt: Date): Promise<void> {
    await db
      .update(pwnboxInstances)
      .set({ expiresAt })
      .where(eq(pwnboxInstances.instanceId, instanceId));
  }

  async updateInstanceEndpoint(
    instanceId: number,
    patch: {
      hostname: string | null;
      assignedIp: string | null;
      sshPort: number;
    },
  ): Promise<void> {
    await db.update(pwnboxInstances).set(patch).where(eq(pwnboxInstances.instanceId, instanceId));
  }

  /** Expired live instances for the TTL monitor (invariant 4). */
  async listExpiredInstances(): Promise<InstanceRow[]> {
    const rows = await db
      .select(this.instanceSelect())
      .from(pwnboxInstances)
      .leftJoin(activityLogs, labEventJoin())
      .where(
        and(
          lt(pwnboxInstances.expiresAt, new Date()),
          inArray(pwnboxInstances.status, ['pending', 'running', 'stopped']),
        ),
      )
      .orderBy(asc(pwnboxInstances.expiresAt));
    return rows
      .map((row) => this.toInstanceRow(row))
      .filter((row): row is InstanceRow => row !== null);
  }

  /** Admin instance monitor (LAB-21), paginated. */
  async listAllInstances(
    page: number,
    pageSize: number,
    statusFilter: LabInstanceStatus | null,
    search: string | null,
  ): Promise<{ rows: AdminInstanceRow[]; total: number }> {
    const conditions = [
      statusFilter ? eq(pwnboxInstances.status, statusFilter) : undefined,
      search
        ? or(
            sql`${users.username} LIKE ${`%${search}%`}`,
            sql`${users.email} LIKE ${`%${search}%`}`,
          )
        : undefined,
    ].filter((condition) => condition !== undefined);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, total] = await Promise.all([
      db
        .select({
          ...this.instanceSelect(),
          labName: labs.labName,
          username: users.username,
        })
        .from(pwnboxInstances)
        .leftJoin(activityLogs, labEventJoin())
        .leftJoin(labs, sql`json_extract(${activityLogs.details}, '$.labId') = ${labs.labId}`)
        .leftJoin(users, eq(pwnboxInstances.userId, users.userId))
        .where(where)
        .orderBy(desc(pwnboxInstances.startedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ count: count() })
        .from(pwnboxInstances)
        .leftJoin(users, eq(pwnboxInstances.userId, users.userId))
        .where(where),
    ]);

    return { rows: rows.map((row) => this.toAdminInstanceRow(row)), total: total[0]?.count ?? 0 };
  }

  /* ── VPN pool ─────────────────────────────────────────────────────────── */

  /**
   * Selects the least-loaded online server for a region (invariant 6), or the
   * least-loaded server in any region as fallback. Runs inside a transaction
   * with `SELECT ... FOR UPDATE` so `current_users` increments atomically
   * (invariant 7).
   */
  async assignVpnServer(userId: number, region: VpnRegion | null): Promise<{
    assignmentId: number;
    server: VpnServerRow;
  }> {
    const assignment = await db.transaction(async (tx) => {
      const candidates = async (preferredRegion: VpnRegion | null) => {
        const rows = await tx
          .select()
          .from(vpnServers)
          .where(
            and(
              eq(vpnServers.isActive, true),
              eq(vpnServers.isMaintenance, false),
              eq(vpnServers.status, 'online'),
              preferredRegion ? eq(vpnServers.region, preferredRegion) : undefined,
            ),
          )
          .for('update');
        return rows.filter((server) => server.currentUsers < server.maxUsers);
      };

      let available = await candidates(region);
      if (available.length === 0 && region) {
        available = await candidates(null);
      }
      if (available.length === 0) {
        return null;
      }

      const server = available.sort(
        (a, b) => a.currentUsers / a.maxUsers - b.currentUsers / b.maxUsers,
      )[0];

      const inserted = await tx
        .insert(vpnAssignments)
        .values({ userId, vpnId: server.vpnId, isActive: true });
      const assignmentId = inserted[0]?.insertId;
      if (!assignmentId) {
        throw new Error('Failed to create VPN assignment.');
      }

      await tx
        .update(vpnServers)
        .set({ currentUsers: server.currentUsers + 1 })
        .where(eq(vpnServers.vpnId, server.vpnId));

      return {
        assignmentId,
        server: {
          vpnId: server.vpnId,
          serverName: server.serverName,
          serverLocation: server.serverLocation,
          region: server.region as VpnRegion,
          maxUsers: server.maxUsers,
          currentUsers: server.currentUsers + 1,
        },
      };
    });

    if (!assignment) {
      throw new Error('NO_VPN_CAPACITY');
    }
    return assignment;
  }

  async findActiveAssignmentForUser(userId: number): Promise<(VpnAssignmentRow & VpnServerRow) | null> {
    const rows = await db
      .select({
        assignmentId: vpnAssignments.assignmentId,
        userId: vpnAssignments.userId,
        vpnId: vpnAssignments.vpnId,
        assignedIp: vpnAssignments.assignedIp,
        ovpnConfigUrl: vpnAssignments.ovpnConfigUrl,
        assignedAt: vpnAssignments.assignedAt,
        expiresAt: vpnAssignments.expiresAt,
        isActive: vpnAssignments.isActive,
        serverName: vpnServers.serverName,
        serverLocation: vpnServers.serverLocation,
        region: vpnServers.region,
        maxUsers: vpnServers.maxUsers,
        currentUsers: vpnServers.currentUsers,
      })
      .from(vpnAssignments)
      .innerJoin(vpnServers, eq(vpnAssignments.vpnId, vpnServers.vpnId))
      .where(and(eq(vpnAssignments.userId, userId), eq(vpnAssignments.isActive, true)))
      .orderBy(desc(vpnAssignments.assignedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async deactivateAssignment(assignmentId: number): Promise<void> {
    await db
      .update(vpnAssignments)
      .set({ isActive: false })
      .where(eq(vpnAssignments.assignmentId, assignmentId));
  }

  /** Ownership-scoped assignment lookup joined to its VPN server (LAB-10 download). */
  async findAssignmentForUser(
    userId: number,
    assignmentId: number,
  ): Promise<{
    assignmentId: number;
    vpnId: number;
    serverName: string;
    ipAddress: string | null;
    port: number;
  } | null> {
    const rows = await db
      .select({
        assignmentId: vpnAssignments.assignmentId,
        vpnId: vpnAssignments.vpnId,
        serverName: vpnServers.serverName,
        ipAddress: vpnServers.ipAddress,
        port: vpnServers.port,
      })
      .from(vpnAssignments)
      .innerJoin(vpnServers, eq(vpnAssignments.vpnId, vpnServers.vpnId))
      .where(and(eq(vpnAssignments.assignmentId, assignmentId), eq(vpnAssignments.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Decrements `current_users` and deactivates the assignment (invariant 7). */
  async releaseVpnAssignment(assignmentId: number, vpnId: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(vpnAssignments)
        .set({ isActive: false })
        .where(eq(vpnAssignments.assignmentId, assignmentId));
      await tx
        .update(vpnServers)
        .set({ currentUsers: sql`GREATEST(${vpnServers.currentUsers} - 1, 0)` })
        .where(eq(vpnServers.vpnId, vpnId));
    });
  }

  /** Decrements `current_users` without touching the assignment row. */
  async decrementVpnServerUsers(vpnId: number): Promise<void> {
    await db
      .update(vpnServers)
      .set({ currentUsers: sql`GREATEST(${vpnServers.currentUsers} - 1, 0)` })
      .where(eq(vpnServers.vpnId, vpnId));
  }

  /* ── Tracks ───────────────────────────────────────────────────────────── */

  async listTracks(includeInactive: boolean): Promise<TrackRow[]> {
    const rows = await db
      .select({
        trackId: tracks.trackId,
        trackName: tracks.trackName,
        slug: tracks.slug,
        description: tracks.description,
        difficultyId: tracks.difficultyId,
        difficultyName: difficultyLevels.name,
        categoryId: tracks.categoryId,
        categoryName: categories.name,
        totalLabs: tracks.totalLabs,
        isActive: tracks.isActive,
        isPremium: tracks.isPremium,
        createdAt: tracks.createdAt,
      })
      .from(tracks)
      .leftJoin(difficultyLevels, eq(tracks.difficultyId, difficultyLevels.difficultyId))
      .leftJoin(categories, eq(tracks.categoryId, categories.categoryId))
      .where(includeInactive ? undefined : eq(tracks.isActive, true))
      .orderBy(asc(tracks.trackName));
    return rows;
  }

  async findTrackById(trackId: number): Promise<TrackRow | null> {
    const rows = await db
      .select({
        trackId: tracks.trackId,
        trackName: tracks.trackName,
        slug: tracks.slug,
        description: tracks.description,
        difficultyId: tracks.difficultyId,
        difficultyName: difficultyLevels.name,
        categoryId: tracks.categoryId,
        categoryName: categories.name,
        totalLabs: tracks.totalLabs,
        isActive: tracks.isActive,
        isPremium: tracks.isPremium,
        createdAt: tracks.createdAt,
      })
      .from(tracks)
      .leftJoin(difficultyLevels, eq(tracks.difficultyId, difficultyLevels.difficultyId))
      .leftJoin(categories, eq(tracks.categoryId, categories.categoryId))
      .where(eq(tracks.trackId, trackId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listTrackContent(trackId: number): Promise<TrackContentRow[]> {
    const rows = await db
      .select({
        trackId: trackContent.trackId,
        contentType: trackContent.contentType,
        contentId: trackContent.contentId,
        displayOrder: trackContent.displayOrder,
        required: trackContent.required,
        labTitle: labs.labName,
        lessonTitle: lessons.title,
      })
      .from(trackContent)
      .leftJoin(labs, and(eq(trackContent.contentType, 'lab'), eq(trackContent.contentId, labs.labId)))
      .leftJoin(lessons, and(eq(trackContent.contentType, 'course'), eq(trackContent.contentId, lessons.lessonId)))
      .where(eq(trackContent.trackId, trackId))
      .orderBy(asc(trackContent.displayOrder));
    return rows.map((row) => ({
      trackId: row.trackId,
      contentType: row.contentType as TrackContentType,
      contentId: row.contentId,
      displayOrder: row.displayOrder,
      required: row.required,
      title: row.labTitle ?? row.lessonTitle ?? 'Unknown item',
    }));
  }

  async insertTrack(input: {
    trackName: string;
    slug: string;
    description: string | null;
    difficultyId: number;
    categoryId: number | null;
    totalLabs: number;
    isPremium: boolean;
  }): Promise<number> {
    const inserted = await db.insert(tracks).values(input);
    const id = inserted[0]?.insertId;
    if (!id) {
      throw new Error('Failed to create track.');
    }
    return id;
  }

  async updateTrack(
    trackId: number,
    patch: {
      trackName?: string;
      slug?: string;
      description?: string | null;
      difficultyId?: number;
      categoryId?: number | null;
      totalLabs?: number;
      isActive?: boolean;
      isPremium?: boolean;
    },
  ): Promise<void> {
    await db.update(tracks).set(patch).where(eq(tracks.trackId, trackId));
  }

  async replaceTrackContent(trackId: number, items: TrackContentInput[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(trackContent).where(eq(trackContent.trackId, trackId));
      if (items.length > 0) {
        await tx.insert(trackContent).values(
          items.map((item) => ({ ...item, trackId })),
        );
      }
    });
  }

  /* ── Activity feed queries (activity_logs is F6's own write target) ────── */

  /** Whether the user already has a LAB_COMPLETED event for a lab (409 gate). */
  async hasLabCompletionEvent(userId: number, labId: number): Promise<boolean> {
    const rows = await db
      .select({ id: activityLogs.logId })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, userId),
          eq(activityLogs.activityType, 'LAB_COMPLETED'),
          sql`json_extract(${activityLogs.details}, '$.labId') = ${labId}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** LAB_STARTED timestamp for an instance (time-taken computation). */
  async findLabStartTime(userId: number, instanceId: number): Promise<Date | null> {
    const rows = await db
      .select({ createdAt: activityLogs.createdAt })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, userId),
          eq(activityLogs.activityType, 'LAB_STARTED'),
          sql`json_extract(${activityLogs.details}, '$.instanceId') = ${instanceId}`,
        ),
      )
      .orderBy(asc(activityLogs.createdAt))
      .limit(1);
    return rows[0]?.createdAt ?? null;
  }

  /** Whether the user already completed a track (TRACK_COMPLETED dedup). */
  async hasTrackCompletionEvent(userId: number, trackId: number): Promise<boolean> {
    const rows = await db
      .select({ id: activityLogs.logId })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, userId),
          eq(activityLogs.activityType, 'TRACK_COMPLETED'),
          sql`json_extract(${activityLogs.details}, '$.trackId') = ${trackId}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Completed lab ids for a user, derived from LAB_COMPLETED events. */
  async listCompletedLabIdsForUser(userId: number): Promise<number[]> {
    const rows = await db
      .select({ labId: sql<number>`json_extract(${activityLogs.details}, '$.labId')` })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, userId),
          eq(activityLogs.activityType, 'LAB_COMPLETED'),
          sql`json_extract(${activityLogs.details}, '$.labId') IS NOT NULL`,
        ),
      );
    return rows.map((row) => Number(row.labId));
  }

  /** Completed lesson ids for a user, derived from LESSON_COMPLETED events. */
  async listCompletedLessonIdsForUser(userId: number): Promise<number[]> {
    const rows = await db
      .select({ lessonId: sql<number>`json_extract(${activityLogs.details}, '$.lessonId')` })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, userId),
          eq(activityLogs.activityType, 'LESSON_COMPLETED'),
          sql`json_extract(${activityLogs.details}, '$.lessonId') IS NOT NULL`,
        ),
      );
    return rows.map((row) => Number(row.lessonId));
  }

  /** Lab titles for track-content items (catalog display). */
  async listLabTitles(labIds: number[]): Promise<Map<number, string>> {
    if (labIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ labId: labs.labId, labName: labs.labName })
      .from(labs)
      .where(inArray(labs.labId, labIds));
    return new Map(rows.map((row) => [row.labId, row.labName]));
  }

  async listLessonTitles(lessonIds: number[]): Promise<Map<number, string>> {
    if (lessonIds.length === 0) {
      return new Map();
    }
    const rows = await db
      .select({ lessonId: lessons.lessonId, title: lessons.title })
      .from(lessons)
      .where(inArray(lessons.lessonId, lessonIds));
    return new Map(rows.map((row) => [row.lessonId, row.title]));
  }

  /** Learner course-content lookup for the AI Mentor context (F4 hook). */
  async findLessonById(
    lessonId: number,
  ): Promise<{ lessonId: number; title: string; content: string | null } | null> {
    const rows = await db
      .select({ lessonId: lessons.lessonId, title: lessons.title, content: lessons.content })
      .from(lessons)
      .where(eq(lessons.lessonId, lessonId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserRow(userId: number): Promise<{ userId: number; username: string } | null> {
    const rows = await db
      .select({ userId: users.userId, username: users.username })
      .from(users)
      .where(eq(users.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /* ── Row mappers ──────────────────────────────────────────────────────── */

  private instanceSelect() {
    return {
      instanceId: pwnboxInstances.instanceId,
      userId: pwnboxInstances.userId,
      vpnId: pwnboxInstances.vpnId,
      labId: derivedLabId,
      labType: derivedLabType,
      hostname: pwnboxInstances.hostname,
      assignedIp: pwnboxInstances.assignedIp,
      sshPort: pwnboxInstances.sshPort,
      rootPassword: pwnboxInstances.rootPassword,
      ramGb: pwnboxInstances.ramGb,
      cpuCores: pwnboxInstances.cpuCores,
      diskGb: pwnboxInstances.diskGb,
      status: pwnboxInstances.status,
      startedAt: pwnboxInstances.startedAt,
      expiresAt: pwnboxInstances.expiresAt,
      terminatedAt: pwnboxInstances.terminatedAt,
    };
  }

  private toInstanceRow(row: InstanceSelectRow | undefined): InstanceRow | null {
    if (!row) {
      return null;
    }
    return {
      instanceId: Number(row.instanceId),
      userId: Number(row.userId),
      vpnId: Number(row.vpnId),
      labId: row.labId !== null ? Number(row.labId) : null,
      labType: row.labType,
      hostname: row.hostname,
      assignedIp: row.assignedIp,
      sshPort: Number(row.sshPort),
      rootPassword: row.rootPassword,
      ramGb: Number(row.ramGb),
      cpuCores: Number(row.cpuCores),
      diskGb: Number(row.diskGb),
      status: row.status,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      terminatedAt: row.terminatedAt,
    };
  }

  private toAdminInstanceRow(row: InstanceSelectRow & {
    labName: string | null;
    username: string | null;
  }): AdminInstanceRow {
    return {
      instanceId: row.instanceId,
      userId: row.userId,
      vpnId: row.vpnId,
      labId: row.labId,
      labType: row.labType,
      hostname: row.hostname,
      assignedIp: row.assignedIp,
      sshPort: row.sshPort,
      rootPassword: row.rootPassword,
      ramGb: row.ramGb,
      cpuCores: row.cpuCores,
      diskGb: row.diskGb,
      status: row.status,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      terminatedAt: row.terminatedAt,
      labName: row.labName,
      username: row.username,
    };
  }

  private toLabRow(
    row: {
      labId: number;
      labName: string;
      slug: string;
      description: string | null;
      difficultyId: number;
      difficultyName: string | null;
      categoryId: number | null;
      categoryName: string | null;
      labType: string;
      isActive: boolean;
      isPremium: boolean;
      estimatedHours: number;
      networkDiagramUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
    } | undefined,
  ): LabRow | null {
    if (!row) {
      return null;
    }
    const labType: LabType =
      row.labType === 'sherlock' || row.labType === 'vip_lab' ? row.labType : 'pro_lab';
    return { ...row, labType };
  }
}

export const labsRepository = new LabsRepository();