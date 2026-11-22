import { describe, expect, it } from 'vitest';
import { httpUrlSchema, positiveIdSchema } from '../../../src/shared/validators';

describe('httpUrlSchema', () => {
  it.each(['https://cdn.example.com/cover.png', 'http://localhost:5173/a?b=c', '  https://example.com/x  '])(
    'accepts http(s) URL %s',
    (value) => {
      expect(httpUrlSchema.safeParse(value).success).toBe(true);
    },
  );

  it('trims surrounding whitespace', () => {
    expect(httpUrlSchema.parse('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'not a url',
    '',
  ])('rejects %s', (value) => {
    expect(httpUrlSchema.safeParse(value).success).toBe(false);
  });

  it('rejects URLs longer than 2048 characters', () => {
    expect(httpUrlSchema.safeParse(`https://example.com/${'a'.repeat(2048)}`).success).toBe(false);
  });
});

describe('positiveIdSchema', () => {
  it('coerces numeric strings and rejects non-positive ids', () => {
    expect(positiveIdSchema.parse('42')).toBe(42);
    expect(positiveIdSchema.safeParse('0').success).toBe(false);
    expect(positiveIdSchema.safeParse('1.5').success).toBe(false);
    expect(positiveIdSchema.safeParse('abc').success).toBe(false);
  });
});
