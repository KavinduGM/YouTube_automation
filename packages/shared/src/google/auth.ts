import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '../env.js';
import { decryptString, encryptString } from '../crypto.js';
import { prisma } from '../db.js';

// Scopes required:
//   YouTube upload + manage:  youtube.upload, youtube
//   Drive read:               drive.readonly
//   Sheets read+write:        spreadsheets
// Identity scopes — required so Google returns an id_token containing email.
// Without these the callback gets no email and we can't key the connection.
const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

export const YOUTUBE_SCOPES = [
  ...IDENTITY_SCOPES,
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];
export const DRIVE_SHEETS_SCOPES = [
  ...IDENTITY_SCOPES,
  // Full Drive access — needed to MOVE files into the "published" folder
  // after upload. drive.readonly + drive.file together are not sufficient
  // because the editor uploads files outside our app's reach.
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

export type ConnectionKind = 'youtube' | 'drive_sheets';

function makeBareClient(): OAuth2Client {
  const e = env();
  return new google.auth.OAuth2({
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: e.GOOGLE_OAUTH_REDIRECT_URI,
  });
}

// Build the URL to start an OAuth flow.
// `state` carries `{kind, channelId?}` so the callback knows what to do.
export function buildAuthUrl(opts: {
  kind: ConnectionKind;
  channelId?: string;
  loginEmail?: string;
}): string {
  const client = makeBareClient();
  const scopes = opts.kind === 'youtube' ? YOUTUBE_SCOPES : DRIVE_SHEETS_SCOPES;
  const state = Buffer.from(
    JSON.stringify({ kind: opts.kind, channelId: opts.channelId, t: Date.now() }),
  ).toString('base64url');
  return client.generateAuthUrl({
    access_type: 'offline',
    // 'select_account' = always show the Google account chooser (so you can
    // switch accounts on Reconnect instead of Google silently reusing the
    // currently-logged-in browser session).
    // 'consent' = force the consent screen so Google issues a refresh_token.
    prompt: 'select_account consent',
    scope: scopes,
    state,
    login_hint: opts.loginEmail,
    include_granted_scopes: true,
  });
}

export function parseState(stateB64: string): { kind: ConnectionKind; channelId?: string; t: number } {
  const obj = JSON.parse(Buffer.from(stateB64, 'base64url').toString('utf8'));
  if (obj.kind !== 'youtube' && obj.kind !== 'drive_sheets') {
    throw new Error('Invalid OAuth state.kind');
  }
  return obj;
}

// Exchange the auth code for tokens.
export async function exchangeCode(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  scopes: string[];
  email: string | null;
  expiresAt: Date | null;
}> {
  const client = makeBareClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. Revoke prior consent at https://myaccount.google.com/permissions and retry.',
    );
  }
  // Get user email from id_token if present
  let email: string | null = null;
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64').toString('utf8'));
      email = (payload.email as string) ?? null;
    } catch {
      // ignore
    }
  }
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? '',
    scopes: tokens.scope?.split(' ') ?? [],
    email,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
}

// Build an authenticated client for a YouTube channel using its stored refresh token.
export async function clientForChannel(channelId: string): Promise<OAuth2Client> {
  const ch = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!ch?.refreshTokenEnc) throw new Error(`Channel ${channelId} has no refresh token. Connect via OAuth.`);
  const client = makeBareClient();
  client.setCredentials({ refresh_token: decryptString(ch.refreshTokenEnc) });
  return client;
}

// Build an authenticated client for Drive + Sheets (single shared connection).
export async function clientForDriveSheets(): Promise<OAuth2Client> {
  const conn = await prisma.googleConnection.findFirst();
  if (!conn) throw new Error('No Google (drive/sheets) connection. Connect via OAuth.');
  const client = makeBareClient();
  client.setCredentials({ refresh_token: decryptString(conn.refreshTokenEnc) });
  return client;
}

// Persist a YouTube channel's refresh token + populate channel id.
export async function saveYouTubeConnection(channelId: string, opts: {
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  const client = makeBareClient();
  client.setCredentials({ refresh_token: opts.refreshToken });
  // Verify scope and fetch channel id
  const yt = google.youtube({ version: 'v3', auth: client });
  const res = await yt.channels.list({ part: ['id', 'snippet'], mine: true });
  const ytChan = res.data.items?.[0];
  if (!ytChan?.id) throw new Error('Could not resolve YouTube channel id from token.');
  await prisma.channel.update({
    where: { id: channelId },
    data: {
      refreshTokenEnc: encryptString(opts.refreshToken),
      scopes: opts.scopes.join(' '),
      youtubeChannelId: ytChan.id,
      youtubeConnectedAt: new Date(),
    },
  });
}

export async function saveDriveSheetsConnection(opts: {
  email: string;
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  await prisma.googleConnection.upsert({
    where: { email: opts.email },
    create: {
      email: opts.email,
      refreshTokenEnc: encryptString(opts.refreshToken),
      scopes: opts.scopes.join(' '),
    },
    update: {
      refreshTokenEnc: encryptString(opts.refreshToken),
      scopes: opts.scopes.join(' '),
    },
  });
}
