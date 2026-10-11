import https from 'https';
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
  name?: string;
  picture?: string;
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

interface HttpResponse {
  status: number;
  data: any;
}

/**
 * HTTPS helper that enforces IPv4 family to prevent undici/Node 24 connect
 * timeouts on environments where DNS advertises unreachable IPv6 routes.
 */
function requestJson(
  url: string,
  options: { method: 'GET' | 'POST'; body?: string; headers?: Record<string, string> },
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const headers = { ...options.headers };
    if (options.body) {
      headers['Content-Length'] = String(Buffer.byteLength(options.body));
    }

    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method,
        family: 4,
        headers,
        timeout: 15_000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let data: any = raw;
          try {
            data = JSON.parse(raw);
          } catch {
            // Keep raw text if not valid JSON
          }
          resolve({ status: res.statusCode || 200, data });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new BadRequestError(`Request to ${parsedUrl.hostname} timed out.`));
    });

    req.on('error', (err) => {
      reject(new BadRequestError(`Network error connecting to ${parsedUrl.hostname}: ${err.message}`));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
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

    const response = await requestJson(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (response.status < 200 || response.status >= 300) {
      const errorMsg =
        response.data?.error_description ||
        response.data?.error ||
        response.data?.message ||
        `Failed to exchange code with ${provider}.`;
      throw new BadRequestError(`OAuth error from ${provider}: ${errorMsg}`);
    }

    const data = response.data as TokenResponse & { error?: string };
    if (data.error) {
      throw new BadRequestError(`OAuth error from ${provider}: ${data.error}`);
    }

    return data.access_token;
  }

  private async getGoogleUser(accessToken: string): Promise<OAuthUserInfo> {
    const response = await requestJson('https://www.googleapis.com/oauth2/v2/userinfo', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (response.status !== 200) {
      const errorMsg =
        response.data?.error?.message ||
        response.data?.message ||
        'Failed to fetch Google user info.';
      throw new BadRequestError(errorMsg);
    }

    const user = response.data as GoogleUser;

    return {
      provider: 'google',
      providerId: user.id,
      email: user.email,
      name: user.name || user.email.split('@')[0],
      avatarUrl: user.picture,
    };
  }

  private async getGitHubUser(accessToken: string): Promise<OAuthUserInfo> {
    const response = await requestJson('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'DevOps-Mentor-App',
      },
    });

    if (response.status !== 200) {
      throw new BadRequestError('Failed to fetch GitHub user info.');
    }

    const user = response.data as GitHubUser;
    let primaryEmail = user.email;

    if (!primaryEmail) {
      const emailResponse = await requestJson('https://api.github.com/user/emails', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'DevOps-Mentor-App',
        },
      });

      if (emailResponse.status === 200 && Array.isArray(emailResponse.data)) {
        const emails = emailResponse.data as GitHubEmail[];
        const primary =
          emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
        if (primary) {
          primaryEmail = primary.email;
        }
      }
    }

    if (!primaryEmail) {
      throw new BadRequestError(
        'Unable to retrieve a verified email from your GitHub account. Please ensure your email is public or verified.',
      );
    }

    return {
      provider: 'github',
      providerId: String(user.id),
      email: primaryEmail,
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url,
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
    }
  }
}

export const oauthService = new OAuthService();
