import { describe, expect, it } from 'vitest';
import {
  formatCourseSlug,
  formatItemSlug,
  formatModuleSlug,
  parseCurriculumSlug,
} from '../../../src/shared/utils';
import { courseSlugSchema, itemSlugSchema, moduleSlugSchema } from '../../../src/shared/validators';

describe('formatCourseSlug', () => {
  it('formats course numbers with two digits', () => {
    expect(formatCourseSlug(1)).toBe('C01');
    expect(formatCourseSlug(15)).toBe('C15');
  });

  it.each([0, 100, 1.5, NaN])('throws RangeError for %s', (value) => {
    expect(() => formatCourseSlug(value)).toThrow(RangeError);
  });
});

describe('formatModuleSlug', () => {
  it('formats a module slug from course slug and module order', () => {
    expect(formatModuleSlug('C01', 3)).toBe('C01M03');
  });

  it('throws RangeError for an invalid course slug', () => {
    expect(() => formatModuleSlug('c01', 1)).toThrow(RangeError);
  });

  it.each([0, 100, 1.5, NaN])('throws RangeError for module order %s', (value) => {
    expect(() => formatModuleSlug('C01', value)).toThrow(RangeError);
  });
});

describe('formatItemSlug', () => {
  it('formats an item slug from module slug and position', () => {
    expect(formatItemSlug('C06M03', 1)).toBe('C06M03L01');
  });

  it('throws RangeError for an invalid module slug', () => {
    expect(() => formatItemSlug('C01', 1)).toThrow(RangeError);
  });

  it.each([0, 100, 1.5, NaN])('throws RangeError for position %s', (value) => {
    expect(() => formatItemSlug('C01M01', value)).toThrow(RangeError);
  });
});

describe('parseCurriculumSlug', () => {
  it('parses item slugs', () => {
    expect(parseCurriculumSlug('C06M03L01')).toEqual({ course: 6, module: 3, item: 1 });
  });

  it('parses module slugs', () => {
    expect(parseCurriculumSlug('C06M03')).toEqual({ course: 6, module: 3, item: null });
  });

  it('parses course slugs', () => {
    expect(parseCurriculumSlug('C06')).toEqual({ course: 6, module: null, item: null });
  });

  it.each(['c06', 'C6', 'C06M3', 'C06M03L1', ''])('returns null for %s', (value) => {
    expect(parseCurriculumSlug(value)).toBeNull();
  });
});

describe('curriculum slug schemas', () => {
  it('courseSlugSchema accepts C01 and rejects malformed codes', () => {
    expect(courseSlugSchema.safeParse('C01').success).toBe(true);
    expect(courseSlugSchema.safeParse('c01').success).toBe(false);
    expect(courseSlugSchema.safeParse('01').success).toBe(false);
    expect(courseSlugSchema.safeParse('C001').success).toBe(false);
  });

  it('moduleSlugSchema accepts C01M03 and rejects malformed codes', () => {
    expect(moduleSlugSchema.safeParse('C01M03').success).toBe(true);
    expect(moduleSlugSchema.safeParse('C01').success).toBe(false);
    expect(moduleSlugSchema.safeParse('c01m03').success).toBe(false);
  });

  it('itemSlugSchema accepts C01M03L01 and rejects malformed codes', () => {
    expect(itemSlugSchema.safeParse('C01M03L01').success).toBe(true);
    expect(itemSlugSchema.safeParse('C01M03').success).toBe(false);
    expect(itemSlugSchema.safeParse('c01m03l01').success).toBe(false);
  });
});
