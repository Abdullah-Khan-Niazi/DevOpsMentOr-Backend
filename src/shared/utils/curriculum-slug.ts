/** Course slug `Cxx` (two digits, uppercase), e.g. `C01`. */
export const COURSE_SLUG_RE = /^C\d{2}$/;

/** Module slug `CxxMxx`, e.g. `C01M03`. */
export const MODULE_SLUG_RE = /^C\d{2}M\d{2}$/;

/** Item slug `CxxMxxLxx`, e.g. `C01M03L01`. */
export const ITEM_SLUG_RE = /^C\d{2}M\d{2}L\d{2}$/;

const COURSE_PARSE_RE = /^C(\d{2})$/;
const MODULE_PARSE_RE = /^C(\d{2})M(\d{2})$/;
const ITEM_PARSE_RE = /^C(\d{2})M(\d{2})L(\d{2})$/;

function assertSlugNumber(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new RangeError(`${label} must be an integer between 1 and 99 (received ${value}).`);
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats a course number as a course slug, e.g. `1` -> `C01`. */
export function formatCourseSlug(n: number): string {
  assertSlugNumber(n, 'Course number');
  return `C${pad2(n)}`;
}

/** Formats a module order inside a course, e.g. (`C01`, 3) -> `C01M03`. */
export function formatModuleSlug(courseSlug: string, moduleOrder: number): string {
  if (!COURSE_SLUG_RE.test(courseSlug)) {
    throw new RangeError(`Course slug must match ${COURSE_SLUG_RE} (received "${courseSlug}").`);
  }
  assertSlugNumber(moduleOrder, 'Module order');
  return `${courseSlug}M${pad2(moduleOrder)}`;
}

/** Formats an item position inside a module, e.g. (`C06M03`, 1) -> `C06M03L01`. */
export function formatItemSlug(moduleSlug: string, position: number): string {
  if (!MODULE_SLUG_RE.test(moduleSlug)) {
    throw new RangeError(`Module slug must match ${MODULE_SLUG_RE} (received "${moduleSlug}").`);
  }
  assertSlugNumber(position, 'Item position');
  return `${moduleSlug}L${pad2(position)}`;
}

/**
 * Parses a course, module or item slug into its numeric parts.
 * Returns `null` when the slug matches none of the three formats (case-sensitive).
 */
export function parseCurriculumSlug(
  slug: string,
): { course: number; module: number | null; item: number | null } | null {
  const item = ITEM_PARSE_RE.exec(slug);
  if (item) {
    return { course: Number(item[1]), module: Number(item[2]), item: Number(item[3]) };
  }
  const module = MODULE_PARSE_RE.exec(slug);
  if (module) {
    return { course: Number(module[1]), module: Number(module[2]), item: null };
  }
  const course = COURSE_PARSE_RE.exec(slug);
  if (course) {
    return { course: Number(course[1]), module: null, item: null };
  }
  return null;
}
