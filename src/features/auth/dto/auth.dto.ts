import type { UserResponseDto } from '../../users/dto/user.dto';

export type AccountType = 'individual' | 'organization' | 'member';

export interface OrganizationInput {
  name: string;
  slug: string;
  description?: string;
  website?: string;
  industry?: string;
  billingEmail?: string;
}

export type RegisterDto =
  | (BaseRegister & { accountType: 'individual' })
  | (BaseRegister & { accountType: 'organization'; organization: OrganizationInput })
  | (BaseRegister & { accountType: 'member'; invitationCode: string });

interface BaseRegister {
  username: string;
  email: string;
  password: string;
  fullName: string;
}

export interface LoginDto {
  email: string;
  password: string;
  totpCode?: string;
}

export interface VerifyEmailDto {
  email: string;
  code: string;
}

export interface ResendVerificationDto {
  email: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  email: string;
  code: string;
  newPassword: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface LogoutDto {
  refreshToken: string;
}

export interface Enable2faDto {
  /** Optional manual confirmation code; when absent a fresh secret is issued. */
  code?: string;
}

export interface Verify2faDto {
  code: string;
  /** Pending secret issued by enable2fa; required for first-time activation. */
  secret?: string;
}

export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponseDto {
  user: UserResponseDto;
  tokens: AuthTokensDto;
}

export type OAuthProvider = 'google' | 'github';

export interface OAuthLoginDto {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
}

export interface OAuthSignupDto {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
  username?: string;
  fullName?: string;
}

/**
 * Returned by oauth login/signup when no local account exists yet. The caller
 * must finish onboarding (choose account type + details) and exchange this
 * single-use token at /auth/oauth/complete.
 */
export interface OAuthPendingResultDto {
  exists: false;
  pendingToken: string;
  email: string;
  name: string;
  provider: OAuthProvider;
}

export type OAuthLoginResultDto = AuthResponseDto | OAuthPendingResultDto;

interface BaseOAuthComplete {
  pendingToken: string;
  username?: string;
  fullName?: string;
}

export type OAuthCompleteDto =
  | (BaseOAuthComplete & { accountType: 'individual' })
  | (BaseOAuthComplete & { accountType: 'organization'; organization: OrganizationInput })
  | (BaseOAuthComplete & { accountType: 'member'; invitationCode: string });

export interface OAuthUserInfo {
  provider: OAuthProvider;
  providerId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface MeResponseDto {
  userId: number;
  username: string;
  email: string;
  fullName: string | null;
  status: string;
  isVerified: boolean;
  twoFactorEnabled: boolean;
  roles: string[];
  permissions: string[];
}

export interface AdminLoginDto {
  email: string;
  password: string;
  totpCode?: string;
}

export interface AdminInviteDto {
  email: string;
  fullName: string;
}

export interface AcceptAdminInviteDto {
  token: string;
  email: string;
  password: string;
  fullName: string;
  username: string;
}

export interface PendingAdminInvite {
  id: string;
  email: string;
  fullName: string;
  expiresAt: string;
}

export interface CreateApiTokenDto {
  tokenName: string;
  expiresInDays?: number;
}

export interface ApiTokenResponseDto {
  tokenId: number;
  tokenName: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface ApiTokenCreatedDto extends ApiTokenResponseDto {
  /** Raw token, returned exactly once at creation. */
  rawToken: string;
}

export interface LoginHistoryEntryDto {
  loginId: number;
  createdAt: string;
  loginType: 'email' | 'google' | 'github';
  isSuccessful: boolean;
  failureReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface TwoFactorSetupDto {
  secret: string;
  otpAuthUri: string;
}

export interface MessageResponseDto {
  message: string;
}