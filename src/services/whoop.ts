import type { WhoopConfig } from '../types/nutrition';

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_SCOPES = [
  'read:profile',
  'read:body_measurement',
  'read:cycles',
  'read:recovery',
  'read:sleep',
  'read:workout',
  'offline',
];

export function makeWhoopState(): string {
  return Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 10).padEnd(8, '0');
}

export function defaultWhoopRedirectUri(): string {
  return `${window.location.origin}/settings`;
}

export function buildWhoopAuthUrl(config: WhoopConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: WHOOP_SCOPES.join(' '),
    state: config.authState,
  });

  return `${WHOOP_AUTH_URL}?${params.toString()}`;
}
