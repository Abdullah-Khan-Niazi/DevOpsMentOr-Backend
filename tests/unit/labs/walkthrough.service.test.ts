import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../src/shared/errors';
import { WalkthroughService, type WalkthroughServiceDeps } from '../../../src/features/labs/services/WalkthroughService';

vi.mock('../../../src/app/cache/redis', () => ({
  redisClient: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
  },
}));

type Mocked<T> = { [K in keyof T]: ReturnType<typeof vi.fn> };

const MARKDOWN = '# Walkthrough\n\nRun `systemctl status nginx`.';
const SLUG = 'C01M01L01';

function labRow(overrides: Record<string, unknown> = {}) {
  return { labId: 1, slug: SLUG, isActive: true, ...overrides };
}

function makeService(overrides: {
  lab?: unknown;
  access?: () => Promise<void>;
  guide?: string | null | (() => Promise<string | null>);
  cacheGet?: () => Promise<string | null>;
  cacheSet?: () => Promise<string>;
} = {}) {
  const repo: Mocked<WalkthroughServiceDeps['repo']> = {
    findLabById: vi.fn(async () => (overrides.lab === undefined ? labRow() : overrides.lab)),
  } as never;
  const entitlement: Mocked<WalkthroughServiceDeps['entitlement']> = {
    assertLabAccess: vi.fn(overrides.access ?? (async () => undefined)),
  } as never;
  const guide = 'guide' in overrides ? overrides.guide : MARKDOWN;
  const adapter: Mocked<WalkthroughServiceDeps['adapter']> = {
    getCatalogGuide: vi.fn(typeof guide === 'function' ? guide : async () => guide),
  } as never;
  const cache: Mocked<WalkthroughServiceDeps['cache']> = {
    get: vi.fn(overrides.cacheGet ?? (async () => null)),
    set: vi.fn(overrides.cacheSet ?? (async () => 'OK')),
  } as never;
  const service = new WalkthroughService({ repo, entitlement, adapter, cache } as WalkthroughServiceDeps);
  return { service, repo, entitlement, adapter, cache };
}

describe('WalkthroughService.getWalkthrough (contracts 4.1, C2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the catalog guide with the lab id and slug, and caches it for 600 seconds', async () => {
    const { service, entitlement, adapter, cache } = makeService();

    const result = await service.getWalkthrough(7, 1);

    expect(result).toEqual({ labId: 1, slug: SLUG, markdown: MARKDOWN });
    expect(entitlement.assertLabAccess).toHaveBeenCalledWith(7, 1);
    expect(adapter.getCatalogGuide).toHaveBeenCalledWith(SLUG);
    expect(cache.set).toHaveBeenCalledWith(`lab_walkthrough:${SLUG}`, MARKDOWN, 'EX', 600);
  });

  it('returns the cached markdown without calling the catalog adapter', async () => {
    const { service, adapter, cache } = makeService({ cacheGet: async () => '# Cached' });

    const result = await service.getWalkthrough(7, 1);

    expect(result.markdown).toBe('# Cached');
    expect(cache.get).toHaveBeenCalledWith(`lab_walkthrough:${SLUG}`);
    expect(adapter.getCatalogGuide).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('throws 404 LAB_NOT_FOUND for an inactive lab without touching entitlement or the catalog', async () => {
    const { service, entitlement, adapter } = makeService({ lab: labRow({ isActive: false }) });

    await expect(service.getWalkthrough(7, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.getWalkthrough(7, 1)).rejects.toMatchObject({
      statusCode: 404,
      errors: [{ code: 'LAB_NOT_FOUND' }],
    });
    expect(entitlement.assertLabAccess).not.toHaveBeenCalled();
    expect(adapter.getCatalogGuide).not.toHaveBeenCalled();
  });

  it('throws 404 LAB_NOT_FOUND when the lab does not exist', async () => {
    const { service } = makeService({ lab: null });

    await expect(service.getWalkthrough(7, 404)).rejects.toMatchObject({ statusCode: 404, errors: [{ code: 'LAB_NOT_FOUND' }] });
  });

  it('propagates 403 when the entitlement check denies access, without calling the catalog', async () => {
    const { service, adapter, cache } = makeService({
      access: async () => {
        throw new ForbiddenError('premium required');
      },
    });

    await expect(service.getWalkthrough(7, 1)).rejects.toBeInstanceOf(ForbiddenError);
    expect(adapter.getCatalogGuide).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('throws 409 LAB_NOT_READY for a malformed slug and never calls the catalog', async () => {
    const { service, adapter } = makeService({ lab: labRow({ slug: 'docker-deep-dive' }) });

    await expect(service.getWalkthrough(7, 1)).rejects.toBeInstanceOf(ConflictError);
    await expect(service.getWalkthrough(7, 1)).rejects.toMatchObject({
      statusCode: 409,
      errors: [{ code: 'LAB_NOT_READY' }],
    });
    expect(adapter.getCatalogGuide).not.toHaveBeenCalled();
  });

  it('throws 404 WALKTHROUGH_NOT_FOUND when the catalog has no guide and caches nothing', async () => {
    const { service, cache } = makeService({ guide: null });

    await expect(service.getWalkthrough(7, 1)).rejects.toMatchObject({
      statusCode: 404,
      errors: [{ code: 'WALKTHROUGH_NOT_FOUND' }],
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('still returns the markdown when the Redis read fails', async () => {
    const { service, adapter } = makeService({
      cacheGet: async () => {
        throw new Error('redis down');
      },
    });

    const result = await service.getWalkthrough(7, 1);

    expect(result.markdown).toBe(MARKDOWN);
    expect(adapter.getCatalogGuide).toHaveBeenCalledTimes(1);
  });

  it('still returns the markdown when the Redis write fails', async () => {
    const { service } = makeService({
      cacheSet: async () => {
        throw new Error('redis down');
      },
    });

    await expect(service.getWalkthrough(7, 1)).resolves.toEqual({ labId: 1, slug: SLUG, markdown: MARKDOWN });
  });

  it('propagates catalog failures instead of returning empty markdown', async () => {
    const { service, cache } = makeService({
      guide: async () => {
        throw new Error('catalog unreachable');
      },
    });

    await expect(service.getWalkthrough(7, 1)).rejects.toThrow('catalog unreachable');
    expect(cache.set).not.toHaveBeenCalled();
  });
});
