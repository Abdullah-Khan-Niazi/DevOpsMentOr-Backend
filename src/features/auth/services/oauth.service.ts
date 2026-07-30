import { env } from '../../../app/config/env';
import { BadRequestError } from '../../../shared/errors';
import type { OAuthProvider, OAuthUserInfo } from '../dto/auth.dto';

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
}

interface GoogleUser {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  picture: string;
}

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface LinkedInUser {
  sub: string;
  email_verified: boolean;
  name: string;
  picture: string;
  email: string;
}

export class OAuthService {
  private async exchangeCode(
    provider: OAuthProvider,
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const configs: Record<
      OAuthProvider,
      { tokenUrl: string; clientId: string; clientSecret: string }
    > = {
      google: {
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
      },
      github: {
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: env.GITHUB_CLIENT_ID ?? '',
        clientSecret: env.GITHUB_CLIENT_SECRET ?? '',
      },
      linkedin: {
        tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
        clientId: env.LINKEDIN_CLIENT_ID ?? '',
        clientSecret: env.LINKEDIN_CLIENT_SECRET ?? '',
      },
    };

    const config = configs[provider];
    if (!config.clientId || !config.clientSecret) {
      throw new BadRequestError(`${provider} OAuth is not configured.`);
    }

    const params = new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new BadRequestError(`Failed to exchange code with ${provider}.`);
    }

    const data = (await response.json()) as TokenResponse & { error?: string };

    if (data.error) {
      throw new BadRequestError(`OAuth error from ${provider}: ${data.error}`);
    }

    return data.access_token;
  }

  private async getGoogleUser(accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new BadRequestError('Failed to fetch Google user info.');
    }

    const user = (await response.json()) as GoogleUser;

    return {
      provider: 'google',
      providerId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.picture,
    };
  }

  private async getGitHubUser(accessToken: string): Promise<OAuthUserInfo> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'DevOps-Mentor-App',
    };

    const response = await fetch('https://api.github.com/user', { headers });

    if (!response.ok) {
      throw new BadRequestError('Failed to fetch GitHub user info.');
    }

    const user = (await response.json()) as GitHubUser;
    let primaryEmail = user.email;

    if (!primaryEmail) {
      const emailResponse = await fetch('https://api.github.com/user/emails', { headers });

      if (emailResponse.ok) {
        const emails = (await emailResponse.json()) as GitHubEmail[];
        const primary = emails.find((e) => e.primary && e.verified)
          ?? emails.find((e) => e.verified);
        if (primary) {
          primaryEmail = primary.email;
        }
      }
    }

    if (!primaryEmail) {
      throw new BadRequestError('Unable to retrieve a verified email from your GitHub account. Please ensure your email is public or verified.');
    }

    return {
      provider: 'github',
      providerId: String(user.id),
      email: primaryEmail,
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url,
    };
  }

  private async getLinkedInUser(accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch(
      'https://api.linkedin.com/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      throw new BadRequestError('Failed to fetch LinkedIn user info.');
    }

    const user = (await response.json()) as LinkedInUser;

    return {
      provider: 'linkedin',
      providerId: user.sub,
      email: user.email,
      name: user.name,
      avatarUrl: user.picture,
    };
  }

  async getUserInfo(
    provider: OAuthProvider,
    code: string,
    redirectUri: string,
  ): Promise<OAuthUserInfo> {
    const accessToken = await this.exchangeCode(provider, code, redirectUri);

    switch (provider) {
      case 'google':
        return this.getGoogleUser(accessToken);
      case 'github':
        return this.getGitHubUser(accessToken);
      case 'linkedin':
        return this.getLinkedInUser(accessToken);
    }
  }
}

export const oauthService = new OAuthService();
