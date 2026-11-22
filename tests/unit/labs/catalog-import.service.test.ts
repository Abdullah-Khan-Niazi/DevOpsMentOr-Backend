import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/shared/errors';
import { CatalogImportService } from '../../../src/features/labs/services/CatalogImportService';
import { containerOrchestrationAdapter } from '../../../src/features/labs/adapters/container-orchestration.adapter';
import { curriculumSlugService } from '../../../src/features/curriculum/services/curriculum-slug.service';
import { db } from '../../../src/app/database';

/**
 * In-memory stand-in for the transactional query builder. Selects are answered
 * from per-table queues (falling back to defaults), writes are recorded in order.
 * Where-clause parameters are logged so the difficulty/category lookups can be asserted.
 */
const fake = vi.hoisted(() => ({
  selectQueues: {} as Record<string, unknown[][]>,
  selectDefaults: {} as Record<string, unknown[]>,
  selectLog: [] as Array<{ table: string; params: unknown[] }>,
  writes: [] as Array<{ op: 'insert' | 'update' | 'delete'; table: string; values?: Record<string, unknown>; id?: number }>,
  nextId: 100,
}));

vi.mock('../../../src/app/database', async () => {
  const { getTableName } = await import('drizzle-orm');
  const { MySqlDialect } = await import('drizzle-orm/mysql-core');
  const dialect = new MySqlDialect();

  const nameOf = (table: unknown): string => getTableName(table as never);

  const readRows = (table: unknown, where: unknown): unknown[] => {
    const name = nameOf(table);
    fake.selectLog.push({
      table: name,
      params: where ? dialect.sqlToQuery(where as never).params : [],
    });
    const queue = fake.selectQueues[name];
    if (queue && queue.length > 0) {
      return queue.shift() ?? [];
    }
    return fake.selectDefaults[name] ?? [];
  };

  const selectBuilder = () => {
    let table: unknown;
    let where: unknown;
    const builder = {
      from(target: unknown) {
        table = target;
        return builder;
      },
      where(condition: unknown) {
        where = condition;
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(readRows(table, where)).then(resolve, reject);
      },
    };
    return builder;
  };

  const insertBuilder = (table: unknown) => {
    let values: Record<string, unknown> | undefined;
    const builder = {
      values(value: Record<string, unknown>) {
        values = value;
        return builder;
      },
      onDuplicateKeyUpdate() {
        return builder;
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        const id = fake.nextId;
        fake.nextId += 1;
        fake.writes.push({ op: 'insert', table: nameOf(table), values, id });
        return Promise.resolve([{ insertId: id }]).then(resolve, reject);
      },
    };
    return builder;
  };

  const updateBuilder = (table: unknown) => {
    let values: Record<string, unknown> | undefined;
    const builder = {
      set(value: Record<string, unknown>) {
        values = value;
        return builder;
      },
      where() {
        return builder;
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        fake.writes.push({ op: 'update', table: nameOf(table), values });
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return builder;
  };

  const deleteBuilder = (table: unknown) => {
    const builder = {
      where() {
        return builder;
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        fake.writes.push({ op: 'delete', table: nameOf(table) });
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return builder;
  };

  const tx = {
    select: () => selectBuilder(),
    insert: (table: unknown) => insertBuilder(table),
    update: (table: unknown) => updateBuilder(table),
    delete: (table: unknown) => deleteBuilder(table),
  };

  return {
    db: {
      transaction: vi.fn(async (callback: (handle: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock('../../../src/features/labs/adapters/container-orchestration.adapter', () => ({
  containerOrchestrationAdapter: {
    getCatalogLab: vi.fn(),
    getCatalogExport: vi.fn(),
    getCatalogGuide: vi.fn(),
  },
}));

vi.mock('../../../src/features/curriculum/services/curriculum-slug.service', () => ({
  curriculumSlugService: {
    recomputeCourse: vi.fn(async () => undefined),
  },
}));

const ACTOR_ID = 9;

/** A lab step that satisfies labSpecV2Schema: one task with a check, one question with answers. */
function catalogSteps() {
  return [
    {
      id: 'check-service',
      title: 'Check the service',
      instructions: 'Confirm nginx is running.',
      kind: 'task' as const,
      setup: [],
      check: {
        type: 'command' as const,
        command: 'systemctl is-active nginx',
        expect: { mode: 'exitCode' as const, value: 0 },
        timeoutMs: 15000,
      },
      hints: [{ id: 'h1', text: 'Try systemctl status.' }],
      points: 25,
      hintCost: 5,
      wrongPenalty: 0,
      guessPenalty: 0,
    },
    {
      id: 'name-it',
      title: 'Name the server',
      instructions: 'Which web server is running?',
      kind: 'question' as const,
      setup: [],
      answer: { accepted: ['nginx'], normalize: 'trim_lower' as const },
      hints: [],
      points: 10,
      hintCost: 5,
      wrongPenalty: 2,
      guessPenalty: 5,
    },
  ];
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'C01M01L01',
    labId: 1,
    courseSlug: 'C01',
    moduleSlug: 'C01M01',
    moduleTitle: 'CLI Fundamentals',
    title: 'Shell Basics',
    description: 'Learn the shell.',
    estimatedHours: 2,
    difficulty: 'Easy',
    category: 'Linux',
    dockerImage: 'devopsmentor/lab-01',
    mode: 'guided' as const,
    scenario: { intro: 'Fix the box.', setup: [] },
    completionBonus: 50,
    steps: catalogSteps(),
    ...overrides,
  };
}

function catalogExport() {
  return {
    track: {
      slug: 'devops-engineering-track',
      trackName: 'End-to-End DevOps Engineering',
      description: 'The full path.',
      milestones: [
        { name: 'First steps', description: 'Finish one lab.', triggerType: 'lab_complete_count', count: 1, points: 10 },
      ],
    },
    courses: [
      {
        slug: 'C01',
        order: 1,
        title: 'Operating System & Linux Basics',
        description: 'Linux foundations.',
        rewards: {
          moduleCompletePoints: 20,
          courseCompletePoints: 100,
          badge: { slug: 'c01-linux', name: 'Linux Pathfinder', description: 'Finished C01.' },
        },
        modules: [
          {
            slug: 'C01M01',
            order: 1,
            moduleTitle: 'CLI Fundamentals',
            lab: manifest(),
          },
        ],
      },
      {
        slug: 'C02',
        order: 2,
        title: 'Containers',
        description: 'Containers.',
        rewards: {
          moduleCompletePoints: 20,
          courseCompletePoints: 100,
          badge: { slug: 'c02-containers', name: 'Container Captain', description: 'Finished C02.' },
        },
        modules: [],
      },
    ],
  };
}

function writesTo(table: string, op: 'insert' | 'update' | 'delete' = 'insert') {
  return fake.writes.filter((write) => write.table === table && write.op === op);
}

describe('CatalogImportService', () => {
  let service: CatalogImportService;

  beforeEach(() => {
    vi.clearAllMocks();
    fake.selectQueues = {};
    fake.selectDefaults = {
      difficulty_levels: [{ difficultyId: 2 }],
      categories: [{ categoryId: 4 }],
    };
    fake.selectLog = [];
    fake.writes = [];
    fake.nextId = 100;
    service = new CatalogImportService();
  });

  describe('importLab', () => {
    it('inserts a new lab and its pro_labs row keyed by the manifest labId', async () => {
      vi.mocked(containerOrchestrationAdapter.getCatalogLab).mockResolvedValue(manifest() as never);

      const result = await service.importLab('C01M01L01', { activateNewLabs: true });

      expect(result).toEqual({ labId: 1, slug: 'C01M01L01', created: true, stepCount: 2 });
      const [labInsert] = writesTo('labs');
      expect(labInsert.values).toMatchObject({
        labId: 1,
        labName: 'Shell Basics',
        slug: 'C01M01L01',
        labType: 'pro_lab',
        isActive: true,
        isPremium: false,
        estimatedHours: 2,
        categoryId: 4,
      });
      const [proLabInsert] = writesTo('pro_labs');
      expect(proLabInsert.values).toMatchObject({
        labId: 1,
        requiredRootCount: 2,
        totalMachines: 1,
        networkIpRange: '172.17.0.0/16',
      });
      expect(proLabInsert.values?.flagValues).toMatchObject({ version: 2, mode: 'guided', completionBonus: 50 });
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('maps catalog difficulty names to difficulty_levels names', async () => {
      vi.mocked(containerOrchestrationAdapter.getCatalogLab).mockResolvedValueOnce(manifest({ difficulty: 'Medium' }) as never);
      vi.mocked(containerOrchestrationAdapter.getCatalogLab).mockResolvedValueOnce(manifest({ difficulty: 'Hard' }) as never);

      await service.importLab('C01M01L01', { activateNewLabs: false });
      await service.importLab('C01M01L01', { activateNewLabs: false });

      const difficultyLookups = fake.selectLog.filter((entry) => entry.table === 'difficulty_levels');
      expect(difficultyLookups.map((entry) => entry.params)).toEqual([['Intermediate'], ['Advanced']]);
    });

    it('updates the existing row by labId and keeps is_active and is_premium on re-import', async () => {
      fake.selectQueues = {
        labs: [[], [], [{ labId: 1 }]],
        pro_labs: [[{ proLabId: 3 }]],
      };
      vi.mocked(containerOrchestrationAdapter.getCatalogLab).mockResolvedValue(manifest() as never);

      const result = await service.importLab('C01M01L01', { activateNewLabs: true });

      expect(result.created).toBe(false);
      expect(writesTo('labs')).toHaveLength(0);
      const [labUpdate] = writesTo('labs', 'update');
      expect(labUpdate.values).toMatchObject({ labName: 'Shell Basics', slug: 'C01M01L01' });
      expect(labUpdate.values).not.toHaveProperty('isActive');
      expect(labUpdate.values).not.toHaveProperty('isPremium');
      expect(writesTo('pro_labs', 'update')).toHaveLength(1);
      expect(writesTo('pro_labs')).toHaveLength(0);
    });

    it('throws 409 SLUG_TAKEN when another lab already owns the slug and writes nothing', async () => {
      fake.selectQueues = { labs: [[{ labId: 77 }]] };
      vi.mocked(containerOrchestrationAdapter.getCatalogLab).mockResolvedValue(manifest() as never);

      await expect(service.importLab('C01M01L01', { activateNewLabs: true })).rejects.toBeInstanceOf(ConflictError);
      fake.selectQueues = { labs: [[{ labId: 77 }]] };
      await expect(service.importLab('C01M01L01', { activateNewLabs: true })).rejects.toMatchObject({
        statusCode: 409,
        errors: [{ code: 'SLUG_TAKEN' }],
      });
      expect(fake.writes).toHaveLength(0);
    });

    it('rejects an invalid spec with LAB_SPEC_INVALID before any write', async () => {
      const steps = catalogSteps();
      steps[0] = { ...steps[0], check: undefined } as never;
      vi.mocked(containerOrchestrationAdapter.getCatalogLab).mockResolvedValue(manifest({ steps }) as never);

      await expect(service.importLab('C01M01L01', { activateNewLabs: true })).rejects.toMatchObject({
        statusCode: 422,
        errors: [{ code: 'LAB_SPEC_INVALID' }, expect.objectContaining({ path: 'steps.0.check' })],
      });
      expect(db.transaction).not.toHaveBeenCalled();
      expect(fake.writes).toHaveLength(0);
    });

    it('throws 404 CATALOG_LAB_NOT_FOUND when Labs has no such lab', async () => {
      vi.mocked(containerOrchestrationAdapter.getCatalogLab).mockResolvedValue(null);

      await expect(service.importLab('C01M01L01', { activateNewLabs: true })).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.importLab('C01M01L01', { activateNewLabs: true })).rejects.toMatchObject({
        errors: [{ code: 'CATALOG_LAB_NOT_FOUND' }],
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('importAll', () => {
    it('creates one track, a course per catalog course (published only with modules), modules and one lab item per module', async () => {
      vi.mocked(containerOrchestrationAdapter.getCatalogExport).mockResolvedValue(catalogExport() as never);

      const summary = await service.importAll({ activateNewLabs: true, createCurriculum: true, actorUserId: ACTOR_ID });

      expect(summary).toMatchObject({ courses: 2, modules: 1, badges: 2, labs: [{ labId: 1, slug: 'C01M01L01' }] });
      expect(summary.trackId).not.toBeNull();

      const [trackInsert] = writesTo('tracks');
      expect(trackInsert.values).toMatchObject({ slug: 'devops-engineering-track', trackName: 'End-to-End DevOps Engineering', isActive: true });
      expect(writesTo('tracks')).toHaveLength(1);

      const courseInserts = writesTo('academy_courses');
      expect(courseInserts.map((write) => write.values?.slug)).toEqual(['C01', 'C02']);
      expect(courseInserts.map((write) => write.values?.isPublished)).toEqual([true, false]);
      expect(courseInserts.every((write) => write.values?.instructorId === ACTOR_ID)).toBe(true);
      const c01Id = courseInserts[0].id;

      const [moduleInsert] = writesTo('modules');
      expect(moduleInsert.values).toMatchObject({ courseId: c01Id, moduleOrder: 1, title: 'CLI Fundamentals', isPublished: true });
      expect(writesTo('modules')).toHaveLength(1);

      const [itemInsert] = writesTo('lessons');
      expect(itemInsert.values).toMatchObject({
        moduleId: moduleInsert.id,
        contentType: 'lab',
        labId: 1,
        title: 'Shell Basics',
        content: null,
        lessonOrder: 1,
        isPublished: true,
      });
      expect(writesTo('lessons')).toHaveLength(1);
      expect(curriculumSlugService.recomputeCourse).toHaveBeenCalledWith(expect.anything(), c01Id);

      expect(writesTo('track_content').map((write) => write.values)).toEqual([
        expect.objectContaining({ contentType: 'course', contentId: c01Id, displayOrder: 1, required: true }),
        expect.objectContaining({ contentType: 'course', contentId: courseInserts[1].id, displayOrder: 2, required: true }),
      ]);
    });

    it('writes the track milestones, per-module and per-course achievements and the course badges', async () => {
      vi.mocked(containerOrchestrationAdapter.getCatalogExport).mockResolvedValue(catalogExport() as never);

      const summary = await service.importAll({ activateNewLabs: true, createCurriculum: true, actorUserId: ACTOR_ID });

      // 1 milestone + 1 module + 2 course completions.
      expect(summary.achievements).toBe(4);
      const achievementNames = writesTo('achievements').map((write) => write.values?.name);
      expect(achievementNames).toEqual([
        'First steps',
        'C01M01 CLI Fundamentals',
        'C01 Operating System & Linux Basics Complete',
        'C02 Containers Complete',
      ]);
      const achievementValues = writesTo('achievements').map((write) => write.values);
      expect(achievementValues[0]).toMatchObject({ triggerType: 'lab_complete_count', triggerValue: { count: 1 }, pointsAwarded: 10 });
      expect(achievementValues[1]).toMatchObject({ triggerType: 'module_complete', pointsAwarded: 20 });
      expect(achievementValues[2]).toMatchObject({ triggerType: 'course_complete', pointsAwarded: 100 });

      const badgeValues = writesTo('badges').map((write) => write.values);
      expect(badgeValues).toHaveLength(2);
      expect(badgeValues[0]).toMatchObject({
        slug: 'c01-linux',
        badgeName: 'Linux Pathfinder',
        criteria: { triggerType: 'course_complete' },
        pointsRequired: 0,
        isHidden: false,
      });
    });

    it('keeps the existing track on re-import instead of inserting a second one', async () => {
      fake.selectQueues = { tracks: [[{ trackId: 5 }]] };
      vi.mocked(containerOrchestrationAdapter.getCatalogExport).mockResolvedValue(catalogExport() as never);

      const summary = await service.importAll({ activateNewLabs: true, createCurriculum: true, actorUserId: ACTOR_ID });

      expect(summary.trackId).toBe(5);
      expect(writesTo('tracks')).toHaveLength(0);
      expect(writesTo('tracks', 'update')).toHaveLength(1);
    });

    it('only imports labs when curriculum creation is disabled', async () => {
      vi.mocked(containerOrchestrationAdapter.getCatalogExport).mockResolvedValue(catalogExport() as never);

      const summary = await service.importAll({ activateNewLabs: false, createCurriculum: false, actorUserId: null });

      expect(summary).toMatchObject({ trackId: null, courses: 0, modules: 0, achievements: 0, badges: 0 });
      expect(summary.labs).toHaveLength(1);
      expect(writesTo('tracks')).toHaveLength(0);
      expect(writesTo('academy_courses')).toHaveLength(0);
      expect(writesTo('labs')[0].values).toMatchObject({ isActive: false });
    });

    it('rejects a module whose slug does not match its position before any write', async () => {
      const catalog = catalogExport();
      catalog.courses[0].modules[0].slug = 'C01M02';
      vi.mocked(containerOrchestrationAdapter.getCatalogExport).mockResolvedValue(catalog as never);

      await expect(
        service.importAll({ activateNewLabs: true, createCurriculum: true, actorUserId: ACTOR_ID }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(fake.writes).toHaveLength(0);
    });

    it('never reads or writes quiz tables', async () => {
      vi.mocked(containerOrchestrationAdapter.getCatalogExport).mockResolvedValue(catalogExport() as never);

      await service.importAll({ activateNewLabs: true, createCurriculum: true, actorUserId: ACTOR_ID });

      const touched = [
        ...fake.writes.map((write) => write.table),
        ...fake.selectLog.map((entry) => entry.table),
      ];
      expect(touched.filter((table) => table.startsWith('quiz'))).toEqual([]);
      expect(writesTo('quizzes')).toHaveLength(0);
      expect(writesTo('quiz_questions')).toHaveLength(0);
    });
  });
});
