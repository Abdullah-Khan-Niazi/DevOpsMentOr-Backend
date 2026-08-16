import { NotFoundError } from '../../../shared/errors';
import type { CertificateDto } from '../dto/gamification.dto';
import type { GamificationRepository } from '../repositories/gamification.repository';
import { gamificationRepository } from '../repositories/gamification.repository';

export interface AdminCertificateServiceDeps {
  repo: Pick<GamificationRepository, 'findCertificateById' | 'updateCertificateValidity'>;
}

function defaultDeps(): AdminCertificateServiceDeps {
  return { repo: gamificationRepository };
}

/** GAM-22: platform-admin certificate invalidation. */
export class AdminCertificateService {
  constructor(private readonly deps: AdminCertificateServiceDeps = defaultDeps()) {}

  async invalidate(certId: number): Promise<CertificateDto> {
    const cert = await this.deps.repo.findCertificateById(certId);
    if (!cert) {
      throw new NotFoundError('Certificate not found.');
    }
    await this.deps.repo.updateCertificateValidity(certId, false);
    return {
      certificateId: cert.certificateId,
      certificateNumber: cert.certificateNumber,
      courseTitle: cert.courseTitle,
      grade: cert.grade === null ? null : Number(cert.grade),
      issuedAt: cert.issuedAt.toISOString(),
      isValid: false,
    };
  }
}

export const adminCertificateService = new AdminCertificateService();