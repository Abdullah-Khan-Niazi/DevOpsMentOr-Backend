import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../app/config';
import { AppError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import { HTTP_STATUS } from '../../../shared/constants';
import { logger } from '../../../shared/logger';
import type { VpnConfigDto, VpnRegion } from '../dto/labs.dto';
import type { LabsRepository } from '../repositories/labs.repository';
import { labsRepository } from '../repositories/labs.repository';

export const OVPN_URL_TTL_SECONDS = 3_600;

export interface VpnServiceDeps {
  repo: Pick<
    LabsRepository,
    | 'assignVpnServer'
    | 'findActiveAssignmentForUser'
    | 'findAssignmentForUser'
    | 'deactivateAssignment'
    | 'decrementVpnServerUsers'
  >;
}

function defaultDeps(): VpnServiceDeps {
  return { repo: labsRepository };
}

function signOvpnUrl(assignmentId: number): { url: string; expiresAt: number; signature: string } {
  const expiresAt = Date.now() + OVPN_URL_TTL_SECONDS * 1_000;
  const signature = createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${assignmentId}:${expiresAt}`)
    .digest('hex');
  const url = `${env.PUBLIC_API_URL}${env.API_PREFIX}/labs/vpn/ovpn/${assignmentId}?exp=${expiresAt}&sig=${signature}`;
  return { url, expiresAt, signature };
}

/** Minimal OpenVPN client config synthesized from the assigned server. */
function buildOvpnConfig(server: { ipAddress: string | null; port: number; serverName: string }): string {
  const remote = server.ipAddress ?? 'vpn.devopsmentor.io';
  return [
    'client',
    'dev tun',
    'proto tcp',
    `remote ${remote} ${server.port}`,
    'resolv-retry infinite',
    'nobind',
    'persist-key',
    'persist-tun',
    'remote-cert-tls server',
    'cipher AES-256-GCM',
    'auth SHA256',
    'verb 3',
    `# DevOps Mentor lab network - ${server.serverName}`,
    '',
  ].join('\n');
}

/**
 * F6 §08 VPN pool management: least-loaded server selection (invariant 6),
 * assignment creation, `current_users` bookkeeping (invariant 7) and the
 * time-limited signed `.ovpn` download URL. Assignment ownership is always
 * `user_id = session.userId`.
 */
export class VpnService {
  constructor(private readonly deps: VpnServiceDeps = defaultDeps()) {}

  /** LAB-10: reuse an active assignment or create one for the preferred region. */
  async getOrCreateAssignment(userId: number, region: VpnRegion | null): Promise<VpnConfigDto> {
    const existing = await this.deps.repo.findActiveAssignmentForUser(userId);
    if (existing) {
      return this.toDto(existing.assignmentId, existing);
    }

    let created: { assignmentId: number; server: { vpnId: number; serverName: string; serverLocation: string | null; region: VpnRegion } };
    try {
      created = await this.deps.repo.assignVpnServer(userId, region);
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_VPN_CAPACITY') {
        logger.warn({ userId }, 'VPN server pool exhausted');
        throw new AppError(
          'No VPN server is available in your region right now. Please try again later.',
          HTTP_STATUS.NOT_FOUND,
        );
      }
      throw error;
    }

    const { url } = signOvpnUrl(created.assignmentId);
    return {
      assignmentId: created.assignmentId,
      vpnId: created.server.vpnId,
      serverName: created.server.serverName,
      serverLocation: created.server.serverLocation,
      region: created.server.region,
      ovpnConfigUrl: url,
      assignedAt: new Date().toISOString(),
      expiresAt: null,
    };
  }

  /** Provision path: guarantees an active assignment exists for the instance. */
  async ensureAssignmentForProvision(userId: number, region: VpnRegion | null): Promise<{
    assignmentId: number;
    vpnId: number;
    ovpnConfigUrl: string | null;
  }> {
    const existing = await this.deps.repo.findActiveAssignmentForUser(userId);
    if (existing) {
      return { assignmentId: existing.assignmentId, vpnId: existing.vpnId, ovpnConfigUrl: null };
    }
    const created = await this.deps.repo.assignVpnServer(userId, region);
    const { url } = signOvpnUrl(created.assignmentId);
    return { assignmentId: created.assignmentId, vpnId: created.server.vpnId, ovpnConfigUrl: url };
  }

  /** Releases the user's active assignment: decrements current_users (invariant 7). */
  async releaseAssignmentForUser(userId: number): Promise<void> {
    const existing = await this.deps.repo.findActiveAssignmentForUser(userId);
    if (!existing) {
      return;
    }
    await this.deps.repo.deactivateAssignment(existing.assignmentId);
    await this.deps.repo.decrementVpnServerUsers(existing.vpnId);
  }

  /** Signed `.ovpn` download: verifies HMAC expiry and assignment ownership. */
  async getOvpnConfigForDownload(
    userId: number,
    assignmentId: number,
    exp: string,
    sig: string,
  ): Promise<{ fileName: string; content: string }> {
    const expiresAt = Number(exp);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      throw new AppError('This VPN config link has expired. Request a new one.', HTTP_STATUS.BAD_REQUEST);
    }
    const expected = createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update(`${assignmentId}:${expiresAt}`)
      .digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenError('Invalid VPN config link.');
    }

    const assignment = await this.deps.repo.findAssignmentForUser(userId, assignmentId);
    if (!assignment) {
      throw new NotFoundError('VPN assignment not found.');
    }

    return {
      fileName: `devops-mentor-${assignment.serverName.replace(/\s+/g, '-').toLowerCase()}.ovpn`,
      content: buildOvpnConfig(assignment),
    };
  }

  private toDto(
    assignmentId: number,
    row: {
      vpnId: number;
      assignedIp: string | null;
      ovpnConfigUrl: string | null;
      assignedAt: Date;
      expiresAt: Date | null;
      serverName: string;
      serverLocation: string | null;
      region: VpnRegion;
    },
  ): VpnConfigDto {
    return {
      assignmentId,
      vpnId: row.vpnId,
      serverName: row.serverName,
      serverLocation: row.serverLocation,
      region: row.region,
      ovpnConfigUrl: row.ovpnConfigUrl ?? signOvpnUrl(assignmentId).url,
      assignedAt: row.assignedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }
}

export const vpnService = new VpnService();