import type { PaginationMeta } from '../types';

export interface PaginationParams {
  page: number;
  limit: number;
}

export function getPaginationParams(page?: number, limit?: number): PaginationParams {
  const safePage = page && page > 0 ? page : 1;
  const safeLimit = limit && limit > 0 ? Math.min(limit, 100) : 10;
  return { page: safePage, limit: safeLimit };
}

export function getSkipTake(page: number, limit: number): { skip: number; take: number } {
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
