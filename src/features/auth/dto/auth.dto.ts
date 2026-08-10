import type { UserResponseDto } from '../../users/dto/user.dto';

export interface RegisterDto {
  username: string;
  email: string;
  password: string;
  fullName: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
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
  username: string;
  fullName: string;
}

export interface OAuthUserInfo {
  provider: OAuthProvider;
  providerId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface MeResponseDto {
  id: number;
  email: string;
  name: string | null;
  roles: string[];
}
