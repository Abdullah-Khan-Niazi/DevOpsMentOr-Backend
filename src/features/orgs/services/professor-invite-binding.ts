import { redisClient } from '../../../app/cache/redis';
import { ORG_CONSTANTS } from '../../../shared/constants';

/**
 * Org-level professor invitations are anchored to the global sentinel team,
 * so the `team_invitations` row carries no organization. Resolving the org
 * from the inviter's PRIMARY scope at accept time is wrong for multi-org
 * inviters, so the target org is bound to the token in Redis at invite time
 * (same TTL as the invitation). No DDL is needed.
 */
const professorInviteOrgKey = (token: string): string => `org:professor_invite_org:${token}`;

export async function bindProfessorInviteOrg(token: string, orgId: number): Promise<void> {
  await redisClient.set(
    professorInviteOrgKey(token),
    String(orgId),
    'EX',
    ORG_CONSTANTS.INVITE_TTL_SECONDS,
  );
}

/** Org bound to the token, or null for invitations issued before the binding existed. */
export async function readProfessorInviteOrg(token: string): Promise<number | null> {
  const raw = await redisClient.get(professorInviteOrgKey(token));
  if (!raw) return null;
  const orgId = Number(raw);
  return Number.isInteger(orgId) && orgId > 0 ? orgId : null;
}

export async function clearProfessorInviteOrg(token: string): Promise<void> {
  await redisClient.del(professorInviteOrgKey(token));
}
