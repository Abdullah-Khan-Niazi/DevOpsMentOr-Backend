import { describe, expect, it } from 'vitest';
import {
  buildPaginationMeta,
  getPaginationParams,
  getSkipTake,
} from '../../src/shared/utils/pagination';

describe('pagination utils', () => {
  it('returns safe default pagination params', () => {
    expect(getPaginationParams()).toEqual({ page: 1, limit: 10 });
  });

  it('caps limit at 100', () => {
    expect(getPaginationParams(2, 500)).toEqual({ page: 2, limit: 100 });
  });

  it('calculates skip and take correctly', () => {
    expect(getSkipTake(3, 20)).toEqual({ skip: 40, take: 20 });
  });

  it('builds pagination metadata', () => {
    expect(buildPaginationMeta(1, 10, 25)).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });
});
