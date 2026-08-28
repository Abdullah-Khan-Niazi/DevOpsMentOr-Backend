import { randomUUID } from 'node:crypto';
import { env } from '../../../app/config';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { CertificateDto, CertificateVerificationDto } from '../dto/gamification.dto';
import type { CertificateRow, GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface CertificateServiceDeps {
  repo: Pick<
    GamificationRepository,
    | 'countTotalPublishedLessons'
    | 'countCompletedLessons'
    | 'listRequiredQuizIds'
    | 'countPassedRequiredQuizzes'
    | 'getGradeData'
    | 'findCertificateByUserCourse'
    | 'findCertificateByNumber'
    | 'findCertificateById'
    | 'insertCertificate'
    | 'updateVerifierIp'
    | 'updateCertificateValidity'
    | 'findUserName'
  >;
  verifyBaseUrl: string;
  maxNumberCollisionRetries: number;
}

function defaultDeps(): CertificateServiceDeps {
  return {
    repo: gamificationRepository,
    verifyBaseUrl: env.CERTIFICATE_VERIFY_BASE_URL,
    maxNumberCollisionRetries: 3,
  };
}

/** Invariant 4: `DM-{YYYY}-{UUID8}` uppercase certificate number. */
function generateCertificateNumber(): string {
  const year = new Date().getFullYear();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `DM-${year}-${suffix}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toCertificateDto(row: CertificateRow): CertificateDto {
  return {
    certificateId: row.certificateId,
    certificateNumber: row.certificateNumber,
    courseTitle: row.courseTitle,
    grade: row.grade === null ? null : Number(row.grade),
    issuedAt: row.issuedAt.toISOString(),
    isValid: row.isValid,
  };
}

/**
 * F7 certificate service (invariants 4, 5, 13). Issuance is triggered by F5 on
 * course completion; `issueCertificate` verifies completion, computes the grade
 * from passed quiz attempts, and persists a globally unique certificate number
 * with an idempotent duplicate (user_id, course_id) guard. `verify` powers the
 * public unauthenticated verification endpoint and exposes no sensitive fields.
 */
export class CertificateService {
  constructor(private readonly deps: CertificateServiceDeps = defaultDeps()) {}

  /** F7 §02 forward hook: called by F5's progress engine on course completion. */
  async issueCertificate(userId: number, courseId: number): Promise<CertificateDto> {
    const [totalLessons, completedLessons] = await Promise.all([
      this.deps.repo.countTotalPublishedLessons(courseId),
      this.deps.repo.countCompletedLessons(userId, courseId),
    ]);
    const requiredQuizIds = await this.deps.repo.listRequiredQuizIds(courseId);
    const passedRequiredQuizzes = await this.deps.repo.countPassedRequiredQuizzes(userId, requiredQuizIds);

    const allLessonsComplete = totalLessons > 0 && completedLessons >= totalLessons;
    const allQuizzesPassed = passedRequiredQuizzes >= requiredQuizIds.length;
    if (!allLessonsComplete || !allQuizzesPassed) {
      throw new BadRequestError('Course has not been fully completed yet.');
    }

    const existing = await this.deps.repo.findCertificateByUserCourse(userId, courseId);
    if (existing) {
      return toCertificateDto(existing);
    }

    const { passedSum, passedCount } = await this.deps.repo.getGradeData(courseId);
    const grade = passedCount > 0 ? round2(passedSum / passedCount) : null;

    let lastError: unknown;
    for (let attempt = 0; attempt < this.deps.maxNumberCollisionRetries; attempt += 1) {
      const certificateNumber = generateCertificateNumber();
      const certificateUrl = `${this.deps.verifyBaseUrl}/verify/${certificateNumber}`;
      try {
        const insertedId = await this.deps.repo.insertCertificate({
          userId,
          courseId,
          certificateNumber,
          grade: grade === null ? null : String(grade),
          certificateUrl,
        });
        return {
          certificateId: insertedId,
          certificateNumber,
          courseTitle: '',
          grade,
          issuedAt: new Date().toISOString(),
          isValid: true,
        };
      } catch (error) {
        // Idempotent guard: another transaction may have issued the certificate
        // for the same (user_id, course_id) concurrently — return the existing row.
        const concurrent = await this.deps.repo.findCertificateByUserCourse(userId, courseId);
        if (concurrent) {
          return toCertificateDto(concurrent);
        }
        lastError = error;
      }
    }
    throw new ConflictError('Could not generate a unique certificate number. Please retry.', [lastError]);
  }

  /** GAM-14: public unauthenticated certificate verification. */
  async verify(certificateNumber: string, ip: string | undefined): Promise<CertificateVerificationDto> {
    const cert = await this.deps.repo.findCertificateByNumber(certificateNumber);
    if (!cert) {
      throw new NotFoundError('Certificate not found.');
    }
    if (ip) {
      await this.deps.repo.updateVerifierIp(cert.certificateId, ip);
    }
    const holder = await this.deps.repo.findUserName(cert.userId);
    return {
      certificateNumber: cert.certificateNumber,
      holderName: holder?.fullName ?? 'Unknown',
      courseTitle: cert.courseTitle,
      issuedAt: cert.issuedAt.toISOString(),
      isValid: cert.isValid,
    };
  }

  /** GAM-13: download URL for the owner (or a platform admin). */
  async getDownloadUrl(userId: number, certId: number, isAdmin: boolean): Promise<{ certificateId: number; url: string | null }> {
    const cert = await this.deps.repo.findCertificateById(certId);
    if (!cert) {
      throw new NotFoundError('Certificate not found.');
    }
    if (!isAdmin && cert.userId !== userId) {
      throw new ForbiddenError('You do not have access to this certificate.');
    }
    return { certificateId: cert.certificateId, url: cert.certificateUrl };
  }

  /** Admin certificate list read (full detail). */
  async findById(certId: number): Promise<CertificateDto | null> {
    const cert = await this.deps.repo.findCertificateById(certId);
    return cert ? toCertificateDto(cert) : null;
  }
}

export const certificateService = new CertificateService();
