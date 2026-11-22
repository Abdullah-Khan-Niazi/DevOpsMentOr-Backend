import { describe, expect, it } from 'vitest';
import {
  aiMentorMessageSchema,
  aiMentorQuerySchema,
  catalogQuerySchema,
  checkStepBodySchema,
  createLabSchema,
  createTrackSchema,
  provisionLabSchema,
  sherlockSubmitSchema,
  emptyBodySchema,
  hintIndexParamSchema,
  hintRevealParamSchema,
  importCatalogLabSchema,
  instanceStepParamSchema,
  saveLabSpecSchema,
  stepIdParamSchema,
  testCheckSchema,
  validateLabSpecSchema,
  trackContentAttachSchema,
  trackContentPatchSchema,
  trackContentReorderSchema,
  updateLabSchema,
  updateTrackSchema,
} from '../../../src/features/labs/validators/labs.validator';

describe('validators (AC-09 + §07 shapes)', () => {
  describe('provisionLabSchema', () => {
    it('accepts a region and strips extras', () => {
      const out = provisionLabSchema.parse({ region: 'EU', extra: true });
      expect(out).toEqual({ region: 'EU' });
    });

    it('rejects an unknown region', () => {
      expect(() => provisionLabSchema.parse({ region: 'MARS' })).toThrow();
    });
  });

  describe('sherlockSubmitSchema', () => {
    it('requires non-empty answers', () => {
      expect(() => sherlockSubmitSchema.parse({ answers: [] })).toThrow();
      expect(() => sherlockSubmitSchema.parse({ answers: [{ questionId: 'q1', answer: '' }] })).toThrow();
      expect(
        sherlockSubmitSchema.parse({ answers: [{ questionId: 'q1', answer: '8080' }] }).answers,
      ).toHaveLength(1);
    });
  });

  describe('aiMentorMessageSchema', () => {
    it('enforces the 1..2000 char message bound', () => {
      expect(() => aiMentorMessageSchema.parse({ message: '', lessonId: 1 })).toThrow();
      expect(() => aiMentorMessageSchema.parse({ message: 'x'.repeat(2001), lessonId: 1 })).toThrow();
      expect(aiMentorMessageSchema.parse({ message: 'hi', lessonId: 1, labId: 2 }).labId).toBe(2);
    });
  });

  describe('createLabSchema', () => {
    it('requires proLabConfig for pro_lab labs', () => {
      expect(() =>
        createLabSchema.parse({
          labName: 'Docker',
          slug: 'docker',
          difficultyId: 1,
          labType: 'pro_lab',
        }),
      ).toThrow();
    });

    it('requires sherlockConfig for sherlock labs', () => {
      expect(() =>
        createLabSchema.parse({
          labName: 'Forensics',
          slug: 'forensics',
          difficultyId: 1,
          labType: 'sherlock',
        }),
      ).toThrow();
    });

    it('accepts a full pro_lab payload and defaults optional fields', () => {
      const out = createLabSchema.parse({
        labName: 'Docker Deep Dive',
        slug: 'docker-deep-dive',
        difficultyId: 1,
        labType: 'pro_lab',
        proLabConfig: { totalMachines: 2, requiredRootCount: 1 },
      });
      expect(out.isPremium).toBe(false);
      expect(out.estimatedHours).toBe(0);
      expect(out.proLabConfig?.networkIpRange).toBeUndefined();
    });

    it('rejects an invalid slug', () => {
      expect(() =>
        createLabSchema.parse({
          labName: 'Docker',
          slug: 'Bad Slug!',
          difficultyId: 1,
          labType: 'vip_lab',
        }),
      ).toThrow();
    });
  });

  describe('lab slugs (C1)', () => {
    it('accepts catalog CxxMxxLxx slugs and lowercase kebab slugs', () => {
      expect(updateLabSchema.parse({ slug: 'C01M03L01' }).slug).toBe('C01M03L01');
      expect(updateLabSchema.parse({ slug: 'forensics-101' }).slug).toBe('forensics-101');
    });

    it('rejects mixed or malformed slugs', () => {
      expect(() => updateLabSchema.parse({ slug: 'Docker-Lab' })).toThrow();
      expect(() => updateLabSchema.parse({ slug: 'C1M3L1' })).toThrow();
      expect(() => updateLabSchema.parse({ slug: 'C01M03L01-x' })).toThrow();
    });
  });

  describe('aiMentorMessageSchema general mode (C4/C5)', () => {
    it('accepts neither id and rejects whitespace-only or unknown keys', () => {
      expect(aiMentorMessageSchema.parse({ message: ' hi ' })).toEqual({ message: 'hi' });
      expect(() => aiMentorMessageSchema.parse({ message: '   ' })).toThrow();
      expect(() => aiMentorMessageSchema.parse({ message: 'hi', courseId: 1 })).toThrow();
    });
  });

  describe('track schemas (D29, C6.2)', () => {
    const base = { trackName: 'Containerization', slug: 'containerization', difficultyId: 2 };

    it('requires difficultyId on create', () => {
      expect(() => createTrackSchema.parse({ trackName: base.trackName, slug: base.slug })).toThrow();
      expect(createTrackSchema.parse(base)).toMatchObject({ difficultyId: 2, isPremium: false });
    });

    it('rejects content and totalLabs (courses attach through the content routes)', () => {
      expect(() =>
        createTrackSchema.parse({ ...base, content: [{ contentType: 'course', contentId: 20, displayOrder: 1 }] }),
      ).toThrow();
      expect(() => createTrackSchema.parse({ ...base, totalLabs: 5 })).toThrow();
      expect(() =>
        updateTrackSchema.parse({ content: [{ contentType: 'course', contentId: 2, displayOrder: 1 }] }),
      ).toThrow();
    });

    it('does not allow clearing difficultyId on update', () => {
      expect(() => updateTrackSchema.parse({ difficultyId: null })).toThrow();
      expect(updateTrackSchema.parse({ difficultyId: 3 }).difficultyId).toBe(3);
    });

    it('validates content attach, patch and reorder bodies', () => {
      expect(trackContentAttachSchema.parse({ courseId: 4 })).toEqual({ courseId: 4, required: true });
      expect(() => trackContentAttachSchema.parse({ courseId: 4, contentType: 'lab' })).toThrow();
      expect(() => trackContentPatchSchema.parse({})).toThrow();
      expect(() => trackContentReorderSchema.parse({ courseIds: [1, 1] })).toThrow();
      expect(trackContentReorderSchema.parse({ courseIds: [2, 1] }).courseIds).toEqual([2, 1]);
    });
  });

  describe('step and hint params', () => {
    it('accepts lowercase step ids and rejects uppercase, spaces and overlong ids', () => {
      expect(stepIdParamSchema.parse({ stepId: 'install-nginx_1' }).stepId).toBe('install-nginx_1');
      for (const bad of ['Install', 'a b', '-lead', '', 'x'.repeat(65)]) {
        expect(() => stepIdParamSchema.parse({ stepId: bad })).toThrow();
      }
    });

    it('limits the hint index to 0..4 and coerces numeric strings', () => {
      expect(hintIndexParamSchema.parse({ hintIndex: '0' }).hintIndex).toBe(0);
      expect(hintIndexParamSchema.parse({ hintIndex: '4' }).hintIndex).toBe(4);
      for (const bad of ['5', '-1', '1.5', 'x']) {
        expect(() => hintIndexParamSchema.parse({ hintIndex: bad })).toThrow();
      }
    });

    it('merges instance, lab and step params for the learner routes', () => {
      expect(instanceStepParamSchema.parse({ instanceId: '4', stepId: 's1', extra: 1 })).toEqual({ instanceId: 4, stepId: 's1' });
      expect(hintRevealParamSchema.parse({ labId: '2', stepId: 's1', hintIndex: '1' })).toEqual({ labId: 2, stepId: 's1', hintIndex: 1 });
      expect(() => instanceStepParamSchema.parse({ instanceId: '0', stepId: 's1' })).toThrow();
    });
  });

  describe('check and empty bodies (strict)', () => {
    it('checkStepBodySchema trims the answer, bounds it to 1..500 and rejects unknown keys', () => {
      expect(checkStepBodySchema.parse({})).toEqual({});
      expect(checkStepBodySchema.parse({ answer: '  nginx ' })).toEqual({ answer: 'nginx' });
      expect(() => checkStepBodySchema.parse({ answer: '   ' })).toThrow();
      expect(() => checkStepBodySchema.parse({ answer: 'x'.repeat(501) })).toThrow();
      expect(() => checkStepBodySchema.parse({ answer: 'a', stepId: 's1' })).toThrow();
    });

    it('emptyBodySchema accepts only {}', () => {
      expect(emptyBodySchema.parse({})).toEqual({});
      expect(() => emptyBodySchema.parse({ x: 1 })).toThrow();
    });
  });

  describe('catalog import and spec bodies', () => {
    it('importCatalogLabSchema accepts only CxxMxxLxx slugs and rejects extras', () => {
      expect(importCatalogLabSchema.parse({ slug: 'C01M01L01' }).slug).toBe('C01M01L01');
      for (const bad of ['c01m01l01', 'C1M1L1', 'C01M01L01x', 'docker-lab', '']) {
        expect(() => importCatalogLabSchema.parse({ slug: bad })).toThrow();
      }
      expect(() => importCatalogLabSchema.parse({ slug: 'C01M01L01', activate: true })).toThrow();
    });

    it('saveLabSpecSchema requires a valid v2 spec; validateLabSpecSchema accepts anything', () => {
      expect(() => saveLabSpecSchema.parse({ spec: { version: 2 } })).toThrow();
      expect(() => saveLabSpecSchema.parse({})).toThrow();
      expect(validateLabSpecSchema.parse({ spec: { version: 1, junk: true } })).toEqual({ spec: { version: 1, junk: true } });
      expect(() => validateLabSpecSchema.parse({ spec: {}, other: 1 })).toThrow();
    });

    it('catalogQuerySchema defaults unusedOnly to false and parses true', () => {
      expect(catalogQuerySchema.parse({}).unusedOnly).toBe(false);
      expect(catalogQuerySchema.parse({ unusedOnly: 'true' }).unusedOnly).toBe(true);
      expect(() => catalogQuerySchema.parse({ unusedOnly: 'yes' })).toThrow();
    });
  });

  describe('testCheckSchema (exactly one of stepId or check)', () => {
    const check = { type: 'command', command: 'true', expect: { mode: 'exitCode', value: 0 } };

    it('accepts stepId alone or a draft check alone', () => {
      expect(testCheckSchema.parse({ instanceId: 3, stepId: 's1' })).toEqual({ instanceId: 3, stepId: 's1' });
      expect(testCheckSchema.parse({ instanceId: 3, check }).check).toMatchObject({ type: 'command' });
    });

    it('rejects both, neither, a bad draft check, a missing instance and unknown keys', () => {
      expect(() => testCheckSchema.parse({ instanceId: 3 })).toThrow();
      expect(() => testCheckSchema.parse({ instanceId: 3, stepId: 's1', check })).toThrow();
      expect(() => testCheckSchema.parse({ instanceId: 3, check: { type: 'command' } })).toThrow();
      expect(() => testCheckSchema.parse({ stepId: 's1' })).toThrow();
      expect(() => testCheckSchema.parse({ instanceId: 3, stepId: 's1', extra: 1 })).toThrow();
    });
  });

  describe('AI mentor optional ids', () => {
    it('message body accepts no ids, one id or both and rejects non-positive ids', () => {
      expect(aiMentorMessageSchema.parse({ message: 'hi' })).toEqual({ message: 'hi' });
      expect(aiMentorMessageSchema.parse({ message: 'hi', labId: 4 })).toEqual({ message: 'hi', labId: 4 });
      expect(() => aiMentorMessageSchema.parse({ message: 'hi', labId: 0 })).toThrow();
      expect(() => aiMentorMessageSchema.parse({ message: 'hi', lessonId: '3' })).toThrow();
    });

    it('query coerces optional numeric ids and leaves them undefined when absent', () => {
      expect(aiMentorQuerySchema.parse({})).toEqual({});
      expect(aiMentorQuerySchema.parse({ lessonId: '3', labId: '4' })).toEqual({ lessonId: 3, labId: 4 });
      expect(() => aiMentorQuerySchema.parse({ labId: '-1' })).toThrow();
    });
  });

  describe('lab slug (create) and track difficulty', () => {
    it('create requires difficultyId and accepts catalog slugs', () => {
      expect(() => createTrackSchema.parse({ trackName: 'DevOps', slug: 'devops' })).toThrow();
      expect(
        createLabSchema.parse({ labName: 'Linux', slug: 'C01M01L01', difficultyId: 1, labType: 'vip_lab' }).slug,
      ).toBe('C01M01L01');
    });
  });
});
