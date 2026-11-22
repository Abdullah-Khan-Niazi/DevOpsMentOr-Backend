import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../src/shared/errors';
import { ModuleItemService, type ModuleItemServiceDeps } from '../../../src/features/curriculum/services/ModuleItemService';
import { curriculumSlugService } from '../../../src/features/curriculum/services/curriculum-slug.service';

vi.mock('../../../src/app/database', () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ tag: 'tx' })) },
}));
vi.mock('../../../src/features/curriculum/services/curriculum-slug.service', () => ({
  curriculumSlugService: { recomputeCourse: vi.fn(async () => undefined) },
}));

type Fn = ReturnType<typeof vi.fn>;

const actor = { userId: 9, ipAddress: '127.0.0.1', userAgent: 'vitest' };

const validSpec = {
  version: 2,
  mode: 'guided',
  scenario: { intro: '', setup: [] },
  completionBonus: 50,
  steps: [
    {
      id: 's1', title: 'Step', instructions: 'Do it', kind: 'task', setup: [],
      check: { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } },
      hints: [], points: 25, hintCost: 5, wrongPenalty: 0, guessPenalty: 0,
    },
  ],
};

function moduleRow(overrides: Record<string, unknown> = {}) {
  return { moduleId: 10, courseId: 1, title: 'Docker', isPublished: true, ...overrides };
}

function itemRow(overrides: Record<string, unknown> = {}) {
  return {
    itemId: 20, moduleId: 10, position: 1, kind: 'lesson', title: 'Intro', slug: 'C01M01L01',
    contentType: 'text', videoDurationSeconds: null, isPublished: false, labId: null, quizId: null,
    lab: null, quiz: null, ...overrides,
  };
}

function makeRepo() {
  return {
    findModuleById: vi.fn(async () => moduleRow()),
    lockModule: vi.fn(async () => true),
    findItemById: vi.fn(async () => itemRow()),
    listItemsByModule: vi.fn(async () => [itemRow({ itemId: 1 }), itemRow({ itemId: 2, position: 2 })]),
    maxLessonOrder: vi.fn(async () => 2),
    createLesson: vi.fn(async () => 21),
    createLabItem: vi.fn(async () => 22),
    createQuizItem: vi.fn(async () => ({ itemId: 23, quizId: 31 })),
    setLessonTags: vi.fn(async () => undefined),
    findTagsByIds: vi.fn(async (ids: number[]) => ids),
    updateLesson: vi.fn(async () => undefined),
    updateQuiz: vi.fn(async () => undefined),
    bulkUpdateLessonOrders: vi.fn(async () => undefined),
    hasItemLearnerData: vi.fn(async () => false),
    deleteLesson: vi.fn(async () => undefined),
    deleteQuiz: vi.fn(async () => undefined),
    setLessonPublished: vi.fn(async () => undefined),
    setQuizPublished: vi.fn(async () => undefined),
    refreshCourseCounts: vi.fn(async () => undefined),
  };
}

function makeService(repoOverrides: Record<string, Fn> = {}, lab: unknown = { labId: 5, labName: 'Linux Basics' }) {
  const repo = { ...makeRepo(), ...repoOverrides };
  const audit = { record: vi.fn(async () => undefined) };
  const labs = { findLabById: vi.fn(async () => lab) };
  const service = new ModuleItemService({ repo, audit, labs } as unknown as ModuleItemServiceDeps);
  return { service, repo, audit, labs };
}

const labItem = (overrides: Record<string, unknown> = {}) => itemRow({
  kind: 'lab', labId: 5,
  lab: { labId: 5, slug: 'lab', labName: 'Linux Basics', difficultyName: 'Easy', estimatedHours: 1, isPremium: false, isActive: true, flagValues: validSpec },
  ...overrides,
});

const quizItem = (count: number, overrides: Record<string, unknown> = {}) => itemRow({
  kind: 'quiz', quizId: 31,
  quiz: { quizId: 31, activeQuestionCount: count, passingScore: 70, timeLimitMinutes: null, isRequired: true, isPublished: false },
  ...overrides,
});

describe('ModuleItemService.createItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a lesson draft at max+1 with tags and recomputes slugs', async () => {
    const { service, repo, audit } = makeService({ findItemById: vi.fn(async () => itemRow({ itemId: 21 })) });
    await service.createItem(actor, 10, { kind: 'lesson', title: 'Intro', contentType: 'text', tagIds: [4, 4, 5] });
    expect(repo.lockModule).toHaveBeenCalledWith(10, expect.anything());
    expect(repo.createLesson).toHaveBeenCalledWith(expect.objectContaining({ moduleId: 10, title: 'Intro', lessonOrder: 3 }), expect.anything());
    expect(repo.setLessonTags).toHaveBeenCalledWith(21, [4, 5], expect.anything());
    expect(curriculumSlugService.recomputeCourse).toHaveBeenCalledWith(expect.anything(), 1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_item' }));
  });

  it('404s when a tag does not exist', async () => {
    const { service, repo } = makeService({ findTagsByIds: vi.fn(async () => [4]) });
    await expect(service.createItem(actor, 10, { kind: 'lesson', title: 'Intro', contentType: 'text', tagIds: [4, 5] }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(repo.createLesson).not.toHaveBeenCalled();
  });

  it('defaults a lab item title to the lab name', async () => {
    const { service, repo } = makeService({ findItemById: vi.fn(async () => labItem({ itemId: 22 })) });
    await service.createItem(actor, 10, { kind: 'lab', labId: 5 });
    expect(repo.createLabItem).toHaveBeenCalledWith(expect.objectContaining({ labId: 5, title: 'Linux Basics', lessonOrder: 3 }), expect.anything());
  });

  it('uses an explicit lab item title and 404s for an unknown lab', async () => {
    const explicit = makeService({ findItemById: vi.fn(async () => labItem({ itemId: 22 })) });
    await explicit.service.createItem(actor, 10, { kind: 'lab', labId: 5, title: 'Custom' });
    expect(explicit.repo.createLabItem).toHaveBeenCalledWith(expect.objectContaining({ title: 'Custom' }), expect.anything());

    const missing = makeService({}, null);
    await expect(missing.service.createItem(actor, 10, { kind: 'lab', labId: 99 })).rejects.toMatchObject({ statusCode: 404 });
    expect(missing.repo.createLabItem).not.toHaveBeenCalled();
  });

  it('creates a quiz item with its quiz in one transaction', async () => {
    const { service, repo } = makeService({ findItemById: vi.fn(async () => quizItem(0, { itemId: 23 })) });
    await service.createItem(actor, 10, { kind: 'quiz', title: 'Quiz', passingScore: 70, isRequired: true });
    expect(repo.createQuizItem).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: 10, lessonOrder: 3, quiz: expect.objectContaining({ title: 'Quiz', passingScore: 70, timeLimitMinutes: null }) }),
      expect.anything(),
    );
  });

  it('404s for a missing module', async () => {
    const { service } = makeService({ findModuleById: vi.fn(async () => null) });
    await expect(service.createItem(actor, 99, { kind: 'quiz', title: 'Quiz', passingScore: 70, isRequired: true }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ModuleItemService.reorderItems', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes positions 1..n and recomputes slugs for the exact set', async () => {
    const { service, repo } = makeService();
    await service.reorderItems(actor, 10, [2, 1]);
    expect(repo.bulkUpdateLessonOrders).toHaveBeenCalledWith(
      10,
      [{ lessonId: 2, lessonOrder: 1 }, { lessonId: 1, lessonOrder: 2 }],
      expect.anything(),
    );
    expect(curriculumSlugService.recomputeCourse).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it.each([[[1]], [[1, 1]], [[1, 2, 3]], [[1, 9]]])('rejects %j with REORDER_SET_MISMATCH', async (ids) => {
    const { service, repo } = makeService();
    await expect(service.reorderItems(actor, 10, ids)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.bulkUpdateLessonOrders).not.toHaveBeenCalled();
  });

  it('validates under the module lock using the rows read inside the transaction', async () => {
    const order: string[] = [];
    const { service } = makeService({
      lockModule: vi.fn(async () => { order.push('lock'); return true; }),
      listItemsByModule: vi.fn(async (_id: number, _o: unknown, tx: unknown) => {
        order.push(tx ? 'list-in-tx' : 'list-outside');
        return [itemRow({ itemId: 1 }), itemRow({ itemId: 2 })];
      }),
    });
    await service.reorderItems(actor, 10, [1, 2]);
    expect(order.slice(0, 2)).toEqual(['lock', 'list-in-tx']);
    expect(order[2]).toBe('list-outside'); // only the final response read happens after the commit
  });

  it('rejects when the item set changed between the lock and the read (stale client)', async () => {
    const { service } = makeService({ listItemsByModule: vi.fn(async () => [itemRow({ itemId: 1 }), itemRow({ itemId: 2 }), itemRow({ itemId: 3 })]) });
    await expect(service.reorderItems(actor, 10, [1, 2])).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ModuleItemService.deleteItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['lesson', itemRow(), 'deleteLesson'],
    ['lab', labItem(), 'deleteLesson'],
    ['quiz', quizItem(2), 'deleteQuiz'],
  ])('refuses to delete a %s item with learner data (ITEM_HAS_LEARNER_DATA)', async (_kind, row) => {
    const { service, repo } = makeService({ findItemById: vi.fn(async () => row), hasItemLearnerData: vi.fn(async () => true) });
    await expect(service.deleteItem(actor, 20)).rejects.toBeInstanceOf(ConflictError);
    expect(repo.deleteLesson).not.toHaveBeenCalled();
    expect(repo.deleteQuiz).not.toHaveBeenCalled();
  });

  it.each([
    ['lesson', itemRow(), 'deleteLesson'],
    ['lab', labItem(), 'deleteLesson'],
    ['quiz', quizItem(2), 'deleteQuiz'],
  ])('deletes a %s item, renumbers the rest and recomputes slugs', async (_kind, row, method) => {
    const { service, repo } = makeService({
      findItemById: vi.fn(async () => row),
      listItemsByModule: vi.fn(async () => [itemRow({ itemId: 7, position: 2 })]),
    });
    await service.deleteItem(actor, 20);
    expect((repo as Record<string, Fn>)[method]).toHaveBeenCalled();
    expect(repo.bulkUpdateLessonOrders).toHaveBeenCalledWith(10, [{ lessonId: 7, lessonOrder: 1 }], expect.anything());
    expect(repo.refreshCourseCounts).toHaveBeenCalledWith(1, expect.anything());
    expect(curriculumSlugService.recomputeCourse).toHaveBeenCalled();
  });
});

describe('ModuleItemService.publishItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes a lesson under the module lock and refreshes the counts', async () => {
    const { service, repo } = makeService();
    await service.publishItem(actor, 20, true);
    expect(repo.lockModule).toHaveBeenCalledWith(10, expect.anything());
    expect(repo.setLessonPublished).toHaveBeenCalledWith(20, true, expect.anything());
    expect(repo.refreshCourseCounts).toHaveBeenCalledWith(1, expect.anything());
  });

  it('refuses with PUBLISH_PARENT_FIRST when the module is a draft', async () => {
    const { service, repo } = makeService({ findModuleById: vi.fn(async () => moduleRow({ isPublished: false })) });
    await expect(service.publishItem(actor, 20, true)).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.setLessonPublished).not.toHaveBeenCalled();
  });

  it('allows unpublishing inside a draft module', async () => {
    const { service, repo } = makeService({ findModuleById: vi.fn(async () => moduleRow({ isPublished: false })) });
    await service.publishItem(actor, 20, false);
    expect(repo.setLessonPublished).toHaveBeenCalledWith(20, false, expect.anything());
  });

  it('refuses a lab item whose lab is inactive or has no v2 spec (LAB_NOT_READY)', async () => {
    const inactive = labItem();
    (inactive.lab as { isActive: boolean }).isActive = false;
    const noSpec = labItem();
    (noSpec.lab as { flagValues: unknown }).flagValues = null;
    for (const row of [inactive, noSpec]) {
      const { service, repo } = makeService({ findItemById: vi.fn(async () => row) });
      await expect(service.publishItem(actor, 20, true)).rejects.toBeInstanceOf(ConflictError);
      expect(repo.setLessonPublished).not.toHaveBeenCalled();
    }
  });

  it('publishes a ready lab item', async () => {
    const { service, repo } = makeService({ findItemById: vi.fn(async () => labItem()) });
    await service.publishItem(actor, 20, true);
    expect(repo.setLessonPublished).toHaveBeenCalledWith(20, true, expect.anything());
    expect(repo.setQuizPublished).not.toHaveBeenCalled();
  });

  it('refuses an empty quiz (QUIZ_EMPTY) and publishes quiz and spine together otherwise', async () => {
    const empty = makeService({ findItemById: vi.fn(async () => quizItem(0)) });
    await expect(empty.service.publishItem(actor, 20, true)).rejects.toBeInstanceOf(ConflictError);
    expect(empty.repo.setQuizPublished).not.toHaveBeenCalled();

    const ok = makeService({ findItemById: vi.fn(async () => quizItem(3)) });
    await ok.service.publishItem(actor, 20, true);
    expect(ok.repo.setLessonPublished).toHaveBeenCalledWith(20, true, expect.anything());
    expect(ok.repo.setQuizPublished).toHaveBeenCalledWith(31, true, expect.anything());
  });

  it('reads the module state inside the transaction, after the lock', async () => {
    const calls: string[] = [];
    const { service } = makeService({
      lockModule: vi.fn(async () => { calls.push('lock'); return true; }),
      findModuleById: vi.fn(async (_id: number, tx: unknown) => { calls.push(tx ? 'module-in-tx' : 'module-outside'); return moduleRow(); }),
      findItemById: vi.fn(async (_id: number, tx: unknown) => { calls.push(tx ? 'item-in-tx' : 'item-outside'); return itemRow(); }),
    });
    await service.publishItem(actor, 20, true);
    expect(calls.indexOf('lock')).toBeLessThan(calls.indexOf('module-in-tx'));
    expect(calls.indexOf('lock')).toBeLessThan(calls.indexOf('item-in-tx'));
    expect(calls).not.toContain('module-outside');
  });

  it('404s when the module vanished before the lock, or the item moved modules', async () => {
    const gone = makeService({ lockModule: vi.fn(async () => false) });
    await expect(gone.service.publishItem(actor, 20, true)).rejects.toBeInstanceOf(NotFoundError);

    const moved = makeService({
      findItemById: vi.fn()
        .mockResolvedValueOnce(itemRow())
        .mockResolvedValue(itemRow({ moduleId: 99 })),
    });
    await expect(moved.service.publishItem(actor, 20, true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s for an unknown item', async () => {
    const { service } = makeService({ findItemById: vi.fn(async () => null) });
    await expect(service.publishItem(actor, 99, true)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ModuleItemService.updateItemTitle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('syncs quizzes.title for a quiz item', async () => {
    const { service, repo } = makeService({ findItemById: vi.fn(async () => quizItem(2)) });
    await service.updateItemTitle(actor, 20, 'New title');
    expect(repo.updateLesson).toHaveBeenCalledWith(20, { title: 'New title' }, expect.anything());
    expect(repo.updateQuiz).toHaveBeenCalledWith(31, { title: 'New title' }, expect.anything());
  });

  it('only updates the item for a lab or lesson', async () => {
    const { service, repo } = makeService({ findItemById: vi.fn(async () => labItem()) });
    await service.updateItemTitle(actor, 20, 'New title');
    expect(repo.updateLesson).toHaveBeenCalled();
    expect(repo.updateQuiz).not.toHaveBeenCalled();
  });
});
