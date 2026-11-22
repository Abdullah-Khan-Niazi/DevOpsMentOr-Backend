import { redisClient } from '../../../app/cache/redis';
import { ERROR_CODES, ConflictError, NotFoundError } from '../../../shared/errors';
import { logger } from '../../../shared/logger';
import { ITEM_SLUG_RE } from '../../../shared/utils/curriculum-slug';
import type { ContainerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import { containerOrchestrationAdapter } from '../adapters/container-orchestration.adapter';
import type { EntitlementService } from './EntitlementService';
import { entitlementService } from './EntitlementService';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

/** Walkthrough markdown is cached in Redis for ten minutes per lab slug. */
const WALKTHROUGH_CACHE_TTL_SECONDS = 600;

export interface WalkthroughResult {
  labId: number;
  slug: string;
  markdown: string;
}

export interface WalkthroughServiceDeps {
  repo: Pick<LabsRepository, 'findLabById'>;
  entitlement: Pick<EntitlementService, 'assertLabAccess'>;
  adapter: Pick<ContainerOrchestrationAdapter, 'getCatalogGuide'>;
  cache: Pick<typeof redisClient, 'get' | 'set'>;
}

function defaultDeps(): WalkthroughServiceDeps {
  return {
    repo: labsRepository,
    entitlement: entitlementService,
    adapter: containerOrchestrationAdapter,
    cache: redisClient,
  };
}

/** Cache key for a lab walkthrough (same layout as the other `cacheKeys` entries). */
function walkthroughCacheKey(slug: string): string {
  return `lab_walkthrough:${slug}`;
}

/**
 * Lab walkthrough (C2): the `lab-guide.md` of the lab's catalog entry, fetched
 * from the Labs catalog through the orchestration adapter. Learners must have
 * an active lab that passes the entitlement check. The slug is validated
 * before any outbound call, and Redis errors never fail the request.
 */
export class WalkthroughService {
  constructor(private readonly deps: WalkthroughServiceDeps = defaultDeps()) {}

  async getWalkthrough(userId: number, labId: number): Promise<WalkthroughResult> {
    const lab = await this.deps.repo.findLabById(labId);
    if (!lab || !lab.isActive) {
      throw new NotFoundError('Lab not found.', [{ code: ERROR_CODES.LAB_NOT_FOUND }]);
    }
    await this.deps.entitlement.assertLabAccess(userId, labId);

    const slug = lab.slug;
    if (!ITEM_SLUG_RE.test(slug)) {
      throw new ConflictError('This lab is not ready for learners yet.', [{ code: ERROR_CODES.LAB_NOT_READY }]);
    }

    const markdown = (await this.readCache(slug)) ?? (await this.fetchAndCache(slug));
    return { labId, slug, markdown };
  }

  private async readCache(slug: string): Promise<string | null> {
    try {
      return await this.deps.cache.get(walkthroughCacheKey(slug));
    } catch (error) {
      logger.error({ err: error, slug }, 'Walkthrough cache read failed');
      return null;
    }
  }

  private async fetchAndCache(slug: string): Promise<string> {
    const markdown = await this.deps.adapter.getCatalogGuide(slug);
    if (markdown === null) {
      throw new NotFoundError('No walkthrough is available for this lab yet.', [
        { code: ERROR_CODES.WALKTHROUGH_NOT_FOUND },
      ]);
    }
    try {
      await this.deps.cache.set(walkthroughCacheKey(slug), markdown, 'EX', WALKTHROUGH_CACHE_TTL_SECONDS);
    } catch (error) {
      logger.error({ err: error, slug }, 'Walkthrough cache write failed');
    }
    return markdown;
  }
}

export const walkthroughService = new WalkthroughService();
