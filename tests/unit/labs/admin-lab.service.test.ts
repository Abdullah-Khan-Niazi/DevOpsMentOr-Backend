import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminLabService, type AdminLabServiceDeps } from '../../../src/features/labs/services/AdminLabService';
import { AppError } from '../../../src/shared/errors';
import { auditLogService } from '../../../src/features/admin/services/audit-log.service';

interface Fake {
  labOwner: unknown[];
  trackRows: Array<Record<string, unknown>>;
  trackExisting: unknown[];
  trackContentRows: Array<{ contentId: number }>;
  courseRows: unknown[];
  proLabQueue: unknown[][];
  proLabDefault: unknown[];
  passers: number;
  writes: Array<{ op: string; table: string; values?: unknown }>;
  executes: number;
  transactions: number;
  txError: unknown;
  nextId: number;
}

const fake = vi.hoisted(() => ({ s: {} as Fake }));

vi.mock('../../../src/features/admin/services/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => undefined) },
}));

vi.mock('../../../src/app/database', async () => {
  const { getTableName } = await import('drizzle-orm');
  const nameOf = (table: unknown): string => getTableName(table as never);

  const resolve = (table: string, keys: string[]): unknown[] => {
    const s = fake.s;
    switch (table) {
      case 'labs':
        return keys.includes('total') ? [{ total: 0 }] : s.labOwner;
      case 'tracks':
        return keys.length === 0 ? s.trackRows : s.trackExisting;
      case 'track_content':
        if (keys.includes('value')) return [{ value: s.trackContentRows.length }];
        if (keys.includes('total')) return [{ trackId: 5, total: s.trackContentRows.length }];
        if (keys.includes('title')) return s.trackContentRows.map((r, i) => ({ courseId: r.contentId, title: `Course ${r.contentId}`, isPublished: true, displayOrder: i + 1, required: true }));
        return s.trackContentRows;
      case 'academy_courses':
        return s.courseRows;
      case 'pro_labs':
        return s.proLabQueue.length > 0 ? (s.proLabQueue.shift() as unknown[]) : s.proLabDefault;
      case 'activity_logs':
        return [{ total: s.passers }];
      default:
        return [];
    }
  };

  const select = (fields?: Record<string, unknown>) => {
    let table = '';
    const keys = fields ? Object.keys(fields) : [];
    const b = {
      from(t: unknown) { table = nameOf(t); return b; },
      innerJoin() { return b; }, where() { return b; }, orderBy() { return b; }, limit() { return b; }, groupBy() { return b; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(resolve(table, keys)).then(res, rej); },
    };
    return b;
  };
  const write = (op: string, target: unknown) => {
    let values: unknown;
    const b = {
      values(v: unknown) { values = v; return b; }, set(v: unknown) { values = v; return b; }, where() { return b; },
      onDuplicateKeyUpdate() { return b; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        fake.s.writes.push({ op, table: nameOf(target), values });
        return Promise.resolve(op === 'insert' ? [{ insertId: fake.s.nextId++ }] : undefined).then(res, rej);
      },
    };
    return b;
  };
  const db: Record<string, unknown> = {
    select,
    insert: (t: unknown) => write('insert', t),
    update: (t: unknown) => write('update', t),
    delete: (t: unknown) => write('delete', t),
    execute: vi.fn(async () => { fake.s.executes += 1; }),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      fake.s.transactions += 1;
      if (fake.s.txError) throw fake.s.txError;
      return fn(db);
    }),
  };
  return { db };
});

const actor = { userId: 3, ipAddress: '127.0.0.1', userAgent: 'vitest' };

const validSpec = (ids: string[] = ['s1']) => ({
  version: 2, mode: 'guided', scenario: { intro: 'Intro', setup: [] }, completionBonus: 50,
  steps: ids.map((id) => ({
    id, title: `Step ${id}`, instructions: 'Do it', kind: 'task', setup: [],
    check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } },
    hints: [], points: 25, hintCost: 5, wrongPenalty: 0, guessPenalty: 0,
  })),
});

const labRow = (overrides: Record<string, unknown> = {}) => ({
  labId: 1, labName: 'Linux Basics', slug: 'C01M01L01', description: null, difficultyId: 1, difficultyName: 'Easy',
  categoryId: null, categoryName: null, labType: 'pro_lab', isActive: false, isPremium: false, estimatedHours: 1,
  networkDiagramUrl: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...overrides,
});

const trackRow = (overrides: Record<string, unknown> = {}) => ({
  trackId: 5, trackName: 'DevOps', slug: 'devops', description: null, difficultyId: 1, categoryId: null,
  isActive: true, isPremium: false, totalLabs: 0, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), ...overrides,
});

function make(deps: Partial<Record<keyof AdminLabServiceDeps, unknown>> = {}) {
  const repo = {
    listLabs: vi.fn(async () => [labRow()]),
    findLabById: vi.fn(async () => labRow()),
    countLabUsage: vi.fn(async () => ({ itemIds: [], activeInstances: 0, learnersWithProgress: 0 })),
    setLabActive: vi.fn(async () => undefined),
    listAllInstances: vi.fn(async () => ({ rows: [], total: 0 })),
    findInstanceById: vi.fn(async () => ({ instanceId: 8, userId: 99, labId: 1, status: 'running' })),
    findInstanceForUser: vi.fn(async () => ({ instanceId: 8, userId: 3, labId: 1, status: 'running' })),
    updateInstanceStatus: vi.fn(async () => undefined),
    ...(deps.repo as object | undefined),
  };
  const orchestration = {
    terminateInstance: vi.fn(async () => undefined),
    listCatalog: vi.fn(async () => []),
    getCatalogLab: vi.fn(async () => ({ slug: 'C01M01L01' })),
    ...(deps.orchestration as object | undefined),
  };
  const catalog = { importLab: vi.fn(async () => ({ labId: 1, slug: 'C01M01L01', created: true, stepCount: 3 })), ...(deps.catalog as object | undefined) };
  const checks = {
    evaluate: vi.fn(async () => ({ passed: true, reason: 'passed', exitCode: 0, statusCode: null, durationMs: 5, stdout: 'out', stderr: '' })),
    ...(deps.checks as object | undefined),
  };
  const service = new AdminLabService({ repo, orchestration, catalog, checks } as unknown as AdminLabServiceDeps);
  return { service, repo, orchestration, catalog, checks };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.s = {
    labOwner: [], trackRows: [trackRow()], trackExisting: [], trackContentRows: [], courseRows: [{ courseId: 4 }],
    proLabQueue: [], proLabDefault: [{ storedSpec: validSpec() }], passers: 0, writes: [], executes: 0, transactions: 0,
    txError: null, nextId: 77,
  };
});

describe('AdminLabService labs', () => {
  it('creates a lab and its pro_labs row in ONE transaction, inactive, with required_root_count owned by the spec', async () => {
    const { service } = make();
    const created = await service.createLab(actor, {
      labName: 'Linux Basics', slug: 'C01M01L01', difficultyId: 1, labType: 'pro_lab', isPremium: false, estimatedHours: 1,
      proLabConfig: { totalMachines: 1, requiredRootCount: 1 }, spec: validSpec(['s1', 's2']),
    } as never);
    expect(fake.s.transactions).toBe(1);
    const insert = fake.s.writes.find((w) => w.op === 'insert' && w.table === 'labs');
    expect(insert?.values).toMatchObject({ slug: 'C01M01L01', isActive: false });
    expect(fake.s.executes).toBe(1);
    expect(fake.s.writes.find((w) => w.table === 'labs')).toBeDefined();
    expect(created.labName).toBe('Linux Basics');
    expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: expect.any(String), targetType: 'lab' }));
  });

  it('creates a sherlock lab with its sherlocks row and no spec, and refuses a spec on a sherlock', async () => {
    const { service } = make();
    await service.createLab(actor, {
      labName: 'Forensics', slug: 'forensics', difficultyId: 1, labType: 'sherlock', isPremium: false, estimatedHours: 0,
      sherlockConfig: { questions: [{ id: 'q1', text: 'Q' }], answers: [{ id: 'q1', answer: 'A' }], requiredCorrectAnswers: 1 },
    } as never);
    expect(fake.s.writes.some((w) => w.op === 'insert' && w.table === 'sherlocks')).toBe(true);
    expect(fake.s.executes).toBe(0);

    await expect(service.createLab(actor, {
      labName: 'Forensics 2', slug: 'forensics-2', difficultyId: 1, labType: 'sherlock', spec: validSpec(),
    } as never)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('422s an invalid spec with LAB_SPEC_INVALID and issue paths, writing nothing', async () => {
    const { service } = make();
    const error = await service.createLab(actor, {
      labName: 'Bad', slug: 'bad-lab', difficultyId: 1, labType: 'pro_lab', proLabConfig: { totalMachines: 1, requiredRootCount: 1 },
      spec: { version: 2, steps: [] },
    } as never).catch((e: unknown) => e) as { statusCode: number; errors: Array<Record<string, unknown>> };
    expect(error.statusCode).toBe(422);
    expect(error.errors[0]).toMatchObject({ code: 'LAB_SPEC_INVALID' });
    expect(error.errors.length).toBeGreaterThan(1);
    expect(fake.s.writes).toHaveLength(0);
    expect(fake.s.transactions).toBe(0);
  });

  it('409s SLUG_TAKEN when slug or title exists, including a duplicate key at insert time', async () => {
    const { service } = make();
    fake.s.labOwner = [{ labId: 9 }];
    await expect(service.createLab(actor, { labName: 'X lab', slug: 'x-lab', difficultyId: 1, labType: 'vip_lab' } as never))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'SLUG_TAKEN' }] });

    fake.s.labOwner = [];
    fake.s.txError = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    await expect(service.createLab(actor, { labName: 'X lab', slug: 'x-lab', difficultyId: 1, labType: 'vip_lab' } as never))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'SLUG_TAKEN' }] });
  });

  describe('saveSpec', () => {
    it('saves a valid spec, upserting pro_labs, and audits', async () => {
      const { service } = make();
      const result = await service.saveSpec(actor, 1, validSpec(['s1', 's2']));
      expect(fake.s.executes).toBe(1);
      expect(result.warnings).toEqual(expect.any(Array));
      expect(auditLogService.record).toHaveBeenCalled();
    });

    it('422s an invalid spec with LAB_SPEC_INVALID and does not write', async () => {
      const { service } = make();
      const error = await service.saveSpec(actor, 1, { version: 2 }).catch((e: unknown) => e) as { statusCode: number; errors: Array<Record<string, unknown>> };
    expect(error.statusCode).toBe(422);
    expect(error.errors[0]).toMatchObject({ code: 'LAB_SPEC_INVALID' });
      expect(fake.s.executes).toBe(0);
    });

    it('422s a sherlock lab and 404s an unknown lab', async () => {
      const sherlock = make({ repo: { findLabById: vi.fn(async () => labRow({ labType: 'sherlock' })) } });
      await expect(sherlock.service.saveSpec(actor, 1, validSpec())).rejects.toMatchObject({ statusCode: 422 });
      const missing = make({ repo: { findLabById: vi.fn(async () => null) } });
      await expect(missing.service.saveSpec(actor, 9, validSpec())).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'LAB_NOT_FOUND' }] });
    });

    it('warns when a removed step id was passed by learners', async () => {
      const { service } = make();
      fake.s.proLabQueue = [[{ storedSpec: validSpec(['s1', 's2']) }]];
      fake.s.passers = 3;
      const result = await service.saveSpec(actor, 1, validSpec(['s1']));
      expect(result.warnings).toContain('Step s2 was removed or renamed; 3 learners passed it');
    });

    it('does not warn for a removed step nobody passed', async () => {
      const { service } = make();
      fake.s.proLabQueue = [[{ storedSpec: validSpec(['s1', 's2']) }]];
      fake.s.passers = 0;
      const result = await service.saveSpec(actor, 1, validSpec(['s1']));
      expect(result.warnings.some((w) => w.includes('removed or renamed'))).toBe(false);
    });
  });

  it('validateSpec never throws: invalid input is reported as issues', () => {
    const { service } = make();
    const bad = service.validateSpec({ nope: true });
    expect(bad.valid).toBe(false);
    expect(bad.issues.length).toBeGreaterThan(0);
    const good = service.validateSpec(validSpec());
    expect(good.valid).toBe(true);
    expect(good.issues).toEqual([]);
  });

  it('import delegates to the catalog importer with activateNewLabs false and audits', async () => {
    const { service, catalog } = make();
    const result = await service.importFromCatalog(actor, 'C01M01L01');
    expect(catalog.importLab).toHaveBeenCalledWith('C01M01L01', { activateNewLabs: false });
    expect(result.created).toBe(true);
    expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ targetId: 1 }));
  });

  describe('catalog', () => {
    const entry = (slug: string) => ({
      slug, courseSlug: 'C01', moduleSlug: 'C01M01', moduleTitle: 'Basics', labId: 'manifest', title: slug, description: '', difficulty: 'Easy',
      category: 'Linux', estimatedHours: 1, dockerImage: 'img', stepCount: 1, steps: [{ id: 's1', title: 'S', kind: 'task', check: 'SECRET' }],
    });

    it('annotates importedLabId and isUsed by slug, exposing only step id, title and kind', async () => {
      const { service } = make({ orchestration: { listCatalog: vi.fn(async () => [entry('C01M01L01'), entry('C01M01L02')]) } });
      const list = await service.catalog(false);
      expect(list.map((e) => [e.slug, e.importedLabId, e.isUsed])).toEqual([['C01M01L01', 1, true], ['C01M01L02', null, false]]);
      expect(list[0].steps).toEqual([{ id: 's1', title: 'S', kind: 'task' }]);
      expect(JSON.stringify(list)).not.toContain('SECRET');
    });

    it('unusedOnly keeps only labs that are not imported', async () => {
      const { service } = make({ orchestration: { listCatalog: vi.fn(async () => [entry('C01M01L01'), entry('C01M01L02')]) } });
      expect((await service.catalog(true)).map((e) => e.slug)).toEqual(['C01M01L02']);
    });
  });

  describe('activation gates', () => {
    it('409s LAB_NOT_READY when the stored spec is not v2', async () => {
      const { service, repo } = make();
      fake.s.proLabDefault = [];
      await expect(service.setActive(actor, 1, true)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'LAB_NOT_READY' }] });
      fake.s.proLabDefault = [{ storedSpec: { cp1: 'legacy' } }];
      await expect(service.setActive(actor, 1, true)).rejects.toMatchObject({ errors: [{ code: 'LAB_NOT_READY' }] });
      expect(repo.setLabActive).not.toHaveBeenCalled();
    });

    it('409s CATALOG_LAB_NOT_FOUND for a slug outside the catalog (or not CxxMxxLxx)', async () => {
      const missing = make({ orchestration: { getCatalogLab: vi.fn(async () => null) } });
      await expect(missing.service.setActive(actor, 1, true)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CATALOG_LAB_NOT_FOUND' }] });
      const badSlug = make({ repo: { findLabById: vi.fn(async () => labRow({ slug: 'forensics' })) } });
      await expect(badSlug.service.setActive(actor, 1, true)).rejects.toMatchObject({ errors: [{ code: 'CATALOG_LAB_NOT_FOUND' }] });
      expect(badSlug.orchestration.getCatalogLab).not.toHaveBeenCalled();
    });

    it('propagates CATALOG_UNAVAILABLE (503) from an unreachable catalog and activates nothing', async () => {
      const down = new AppError('Catalog down', 503, [{ code: 'CATALOG_UNAVAILABLE' }]);
      const { service, repo } = make({ orchestration: { getCatalogLab: vi.fn(async () => { throw down; }) } });
      await expect(service.setActive(actor, 1, true)).rejects.toMatchObject({ statusCode: 503, errors: [{ code: 'CATALOG_UNAVAILABLE' }] });
      expect(repo.setLabActive).not.toHaveBeenCalled();
    });

    it('activates a ready lab and deactivates without any gate', async () => {
      const { service, repo, orchestration } = make();
      await expect(service.setActive(actor, 1, true)).resolves.toEqual({ labId: 1, isActive: true });
      expect(repo.setLabActive).toHaveBeenCalledWith(1, true);
      orchestration.getCatalogLab.mockClear();
      fake.s.proLabDefault = [];
      await expect(service.setActive(actor, 1, false)).resolves.toEqual({ labId: 1, isActive: false });
      expect(orchestration.getCatalogLab).not.toHaveBeenCalled();
    });
  });

  describe('deleteLab guards', () => {
    it('refuses a lab used by a module item (LAB_IN_USE) or with learner data (LAB_HAS_LEARNER_DATA)', async () => {
      const used = make({ repo: { countLabUsage: vi.fn(async () => ({ itemIds: [4], activeInstances: 0, learnersWithProgress: 0 })) } });
      await expect(used.service.deleteLab(actor, 1)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'LAB_IN_USE' }] });
      const data = make({ repo: { countLabUsage: vi.fn(async () => ({ itemIds: [], activeInstances: 0, learnersWithProgress: 2 })) } });
      await expect(data.service.deleteLab(actor, 1)).rejects.toMatchObject({ errors: [{ code: 'LAB_HAS_LEARNER_DATA' }] });
      const running = make({ repo: { countLabUsage: vi.fn(async () => ({ itemIds: [], activeInstances: 1, learnersWithProgress: 0 })) } });
      await expect(running.service.deleteLab(actor, 1)).rejects.toMatchObject({ errors: [{ code: 'LAB_HAS_LEARNER_DATA' }] });
      expect(fake.s.writes.filter((w) => w.op === 'delete')).toHaveLength(0);
    });

    it('deletes an unused lab', async () => {
      const { service } = make();
      await expect(service.deleteLab(actor, 1)).resolves.toEqual({ labId: 1 });
      expect(fake.s.writes.filter((w) => w.op === 'delete' && w.table === 'labs')).toHaveLength(1);
    });
  });

  describe('testCheck', () => {
    const check = { type: 'command' as const, command: 'true', expect: { mode: 'exitCode' as const, value: 0 } };

    it('uses the caller\'s own instance without labs-admin and any instance with it', async () => {
      const own = make();
      await own.service.testCheck(actor, 1, { instanceId: 8, check }, false);
      expect(own.repo.findInstanceForUser).toHaveBeenCalledWith(3, 8);
      expect(own.repo.findInstanceById).not.toHaveBeenCalled();
      const admin = make();
      await admin.service.testCheck(actor, 1, { instanceId: 8, check }, true);
      expect(admin.repo.findInstanceById).toHaveBeenCalledWith(8);
      expect(admin.repo.findInstanceForUser).not.toHaveBeenCalled();
    });

    it('404s someone else\'s instance, 409s a lab mismatch and a stopped instance', async () => {
      const foreign = make({ repo: { findInstanceForUser: vi.fn(async () => null) } });
      await expect(foreign.service.testCheck(actor, 1, { instanceId: 8, check }, false)).rejects.toMatchObject({ statusCode: 404 });
      const mismatch = make({ repo: { findInstanceForUser: vi.fn(async () => ({ instanceId: 8, labId: 2, status: 'running' })) } });
      await expect(mismatch.service.testCheck(actor, 1, { instanceId: 8, check }, false)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'INSTANCE_LAB_MISMATCH' }] });
      const stopped = make({ repo: { findInstanceForUser: vi.fn(async () => ({ instanceId: 8, labId: 1, status: 'stopped' })) } });
      await expect(stopped.service.testCheck(actor, 1, { instanceId: 8, check }, false)).rejects.toMatchObject({ errors: [{ code: 'INSTANCE_NOT_RUNNING' }] });
      expect(foreign.checks.evaluate).not.toHaveBeenCalled();
    });

    it('evaluates the SAVED check for a stepId, never a client one, and writes no ledger or activity rows', async () => {
      const { service, checks } = make();
      const { result } = await service.testCheck(actor, 1, { instanceId: 8, stepId: 's1' }, false);
      expect(checks.evaluate).toHaveBeenCalledWith(8, expect.objectContaining({ type: 'command', command: 'true' }));
      expect(result).toMatchObject({ passed: true, reason: 'passed', exitCode: 0 });
      expect(fake.s.writes).toHaveLength(0);
    });

    it('404s an unknown step, 422s a question step and 409s a lab without a v2 spec', async () => {
      const { service } = make();
      await expect(service.testCheck(actor, 1, { instanceId: 8, stepId: 'nope' }, false)).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'STEP_NOT_FOUND' }] });
      const question = { ...validSpec(), steps: [{ id: 'q', title: 'Q', instructions: 'Q?', kind: 'question', setup: [], answer: { accepted: ['a'], normalize: 'trim_lower' }, hints: [], points: 10, hintCost: 5, wrongPenalty: 2, guessPenalty: 5 }] };
      fake.s.proLabDefault = [{ storedSpec: question }];
      await expect(service.testCheck(actor, 1, { instanceId: 8, stepId: 'q' }, false)).rejects.toMatchObject({ statusCode: 422 });
      fake.s.proLabDefault = [];
      await expect(service.testCheck(actor, 1, { instanceId: 8, stepId: 's1' }, false)).rejects.toMatchObject({ errors: [{ code: 'LAB_NOT_READY' }] });
    });

    it('422s when neither stepId nor check is given, and truncates stdout and stderr to 4096 characters', async () => {
      const { service } = make({ checks: { evaluate: vi.fn(async () => ({ passed: false, reason: 'not_passed', exitCode: 1, statusCode: null, durationMs: 1, stdout: 'x'.repeat(9000), stderr: 'y'.repeat(5000) })) } });
      await expect(service.testCheck(actor, 1, { instanceId: 8 }, false)).rejects.toMatchObject({ statusCode: 422 });
      const { result } = await service.testCheck(actor, 1, { instanceId: 8, check }, false);
      expect(result.stdout).toHaveLength(4096);
      expect(result.stderr).toHaveLength(4096);
    });
  });
});

describe('AdminLabService tracks', () => {
  it('409s SINGLE_TRACK_ONLY when a track already exists and creates the first one', async () => {
    const { service } = make();
    fake.s.trackExisting = [{ trackId: 5 }];
    await expect(service.createTrack(actor, { trackName: 'Second', slug: 'second', difficultyId: 1, isPremium: false } as never))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'SINGLE_TRACK_ONLY' }] });
    expect(fake.s.writes.some((w) => w.op === 'insert')).toBe(false);

    fake.s.trackExisting = [];
    const created = await service.createTrack(actor, { trackName: 'DevOps', slug: 'devops', difficultyId: 1, isPremium: false } as never);
    expect(created.trackName).toBe('DevOps');
    expect(fake.s.writes.find((w) => w.op === 'insert' && w.table === 'tracks')?.values).toMatchObject({ isActive: true, totalLabs: 0 });
  });

  it('attaches a course at max+1 and recomputes total_labs in the same transaction', async () => {
    const { service } = make();
    fake.s.trackContentRows = [];
    await service.attachTrackContent(actor, 5, { courseId: 4, required: true });
    expect(fake.s.transactions).toBe(1);
    const insert = fake.s.writes.find((w) => w.op === 'insert' && w.table === 'track_content');
    expect(insert?.values).toMatchObject({ trackId: 5, contentType: 'course', contentId: 4, displayOrder: 1, required: true });
    expect(fake.s.writes.some((w) => w.op === 'update' && w.table === 'tracks')).toBe(true);
  });

  it('404s COURSE_NOT_FOUND for an unknown course and 409s TRACK_CONTENT_EXISTS for a duplicate', async () => {
    const { service } = make();
    fake.s.courseRows = [];
    await expect(service.attachTrackContent(actor, 5, { courseId: 99, required: true })).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'COURSE_NOT_FOUND' }] });
    fake.s.courseRows = [{ courseId: 4 }];
    fake.s.trackContentRows = [{ contentId: 4 }];
    await expect(service.attachTrackContent(actor, 5, { courseId: 4, required: true })).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'TRACK_CONTENT_EXISTS' }] });
  });

  it('404s TRACK_CONTENT_NOT_FOUND when updating or detaching a course that is not attached', async () => {
    const { service } = make();
    fake.s.trackContentRows = [];
    await expect(service.updateTrackContent(actor, 5, 4, { required: false })).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'TRACK_CONTENT_NOT_FOUND' }] });
    await expect(service.detachTrackContent(actor, 5, 4)).rejects.toMatchObject({ errors: [{ code: 'TRACK_CONTENT_NOT_FOUND' }] });
  });

  it('detaches an attached course and compacts the remaining display orders', async () => {
    const { service } = make();
    fake.s.trackContentRows = [{ contentId: 4 }, { contentId: 6 }];
    await service.detachTrackContent(actor, 5, 4);
    expect(fake.s.writes.some((w) => w.op === 'delete' && w.table === 'track_content')).toBe(true);
    expect(fake.s.writes.filter((w) => w.op === 'update' && w.table === 'track_content').length).toBeGreaterThan(0);
  });

  it('rejects a reorder that is not the exact attached set (REORDER_SET_MISMATCH) and accepts the exact set', async () => {
    const { service } = make();
    fake.s.trackContentRows = [{ contentId: 1 }, { contentId: 2 }];
    for (const bad of [[1], [1, 1], [1, 2, 3], [1, 9]]) {
      await expect(service.reorderTrackContent(actor, 5, bad)).rejects.toMatchObject({ statusCode: 422, errors: [{ code: 'REORDER_SET_MISMATCH' }] });
    }
    expect(fake.s.writes.filter((w) => w.op === 'update')).toHaveLength(0);
    await service.reorderTrackContent(actor, 5, [2, 1]);
    expect(fake.s.writes.filter((w) => w.op === 'update' && w.table === 'track_content')).toHaveLength(2);
  });

  it('404s an unknown track and 409s a taken slug on update', async () => {
    const { service } = make();
    fake.s.trackRows = [];
    await expect(service.getTrack(99)).rejects.toMatchObject({ statusCode: 404 });
    fake.s.trackRows = [trackRow()];
    fake.s.trackExisting = [{ trackId: 6 }];
    await expect(service.updateTrack(actor, 5, { slug: 'taken' })).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'SLUG_TAKEN' }] });
  });
});

describe('AdminLabService instances', () => {
  it('terminates through the orchestrator then marks the instance terminated; failures are 400 and leave the row alone', async () => {
    const { service, orchestration, repo } = make();
    await expect(service.terminateInstanceAdmin(actor, 8)).resolves.toEqual({ instanceId: 8, status: 'terminated' });
    expect(orchestration.terminateInstance).toHaveBeenCalledWith(8);
    expect(repo.updateInstanceStatus).toHaveBeenCalledWith(8, 'terminated');

    const failing = make({ orchestration: { terminateInstance: vi.fn(async () => { throw new Error('boom'); }) } });
    await expect(failing.service.terminateInstanceAdmin(actor, 8)).rejects.toMatchObject({ statusCode: 400 });
    expect(failing.repo.updateInstanceStatus).not.toHaveBeenCalled();
    const missing = make({ repo: { findInstanceById: vi.fn(async () => null) } });
    await expect(missing.service.terminateInstanceAdmin(actor, 404)).rejects.toMatchObject({ statusCode: 404 });
  });
});

