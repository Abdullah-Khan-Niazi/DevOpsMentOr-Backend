import { describe, expect, it } from 'vitest';
import {
  aiMentorMessageSchema,
  createLabSchema,
  createTrackSchema,
  provisionLabSchema,
  sherlockSubmitSchema,
  updateTrackSchema,
} from '../../src/features/labs/validators/labs.validator';

describe('F6 validators (AC-09 + §07 shapes)', () => {
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

  describe('track content schemas (AC-09)', () => {
    it('rejects machine/challenge content types with 422', () => {
      const base = {
        trackName: 'Containerization',
        slug: 'containerization',
        content: [{ contentType: 'machine', contentId: 1, displayOrder: 1 }],
      };
      expect(() => createTrackSchema.parse(base)).toThrow();
      expect(() =>
        updateTrackSchema.parse({ content: [{ contentType: 'challenge', contentId: 2, displayOrder: 1 }] }),
      ).toThrow();
    });

    it('accepts only lab/course content types', () => {
      const out = createTrackSchema.parse({
        trackName: 'Containerization',
        slug: 'containerization',
        content: [{ contentType: 'course', contentId: 20, displayOrder: 1, required: true }],
      });
      expect(out.content?.[0].contentType).toBe('course');
    });
  });
});