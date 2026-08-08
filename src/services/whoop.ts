import type { DailyTargets, Macros, WhoopConfig, WhoopSummary } from '../types/nutrition';

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

interface WhoopTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

function tokenConfigFromResponse(config: WhoopConfig, token: WhoopTokenResponse): WhoopConfig {
  return {
    ...config,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || config.refreshToken,
    expiresAt: new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000).toISOString(),
    tokenType: token.token_type || 'bearer',
    scope: token.scope || config.scope,
    connectedAt: config.connectedAt || new Date().toISOString(),
  };
}

async function postWhoopToken(payload: Record<string, string>): Promise<WhoopTokenResponse> {
  const response = await fetch('/api/whoop/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'WHOOP token request failed.');
  }
  return data as WhoopTokenResponse;
}

export async function exchangeWhoopCode(config: WhoopConfig, code: string): Promise<WhoopConfig> {
  const token = await postWhoopToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
  });
  return tokenConfigFromResponse({ ...config, authorizationCode: code }, token);
}

export async function refreshWhoopToken(config: WhoopConfig): Promise<WhoopConfig> {
  if (!config.refreshToken) throw new Error('WHOOP refresh token is missing. Reconnect WHOOP.');
  const token = await postWhoopToken({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.clientId,
  });
  return tokenConfigFromResponse(config, token);
}

export async function ensureWhoopAccess(config: WhoopConfig): Promise<WhoopConfig> {
  if (!config.accessToken) throw new Error('WHOOP is not connected yet.');
  if (!config.expiresAt || new Date(config.expiresAt).getTime() <= Date.now()) {
    return refreshWhoopToken(config);
  }
  return config;
}

export async function fetchWhoopSummary(config: WhoopConfig): Promise<WhoopSummary> {
  const response = await fetch('/api/whoop/summary', {
    headers: {
      Authorization: `${config.tokenType || 'bearer'} ${config.accessToken}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'WHOOP summary request failed.');
  }
  return data as WhoopSummary;
}

export function whoopNutritionContext(summary: WhoopSummary | null | undefined): string | null {
  if (!summary) return null;

  const parts: string[] = [];
  if (summary.cycle?.strain != null) parts.push(`strain ${summary.cycle.strain.toFixed(1)}`);
  if (summary.recovery?.score != null) parts.push(`recovery ${Math.round(summary.recovery.score)}%`);
  if (summary.sleep?.performancePercentage != null) {
    parts.push(`sleep performance ${Math.round(summary.sleep.performancePercentage)}%`);
  }
  if (summary.sleep?.totalSleepHours != null && summary.sleep.totalSleepHours > 0) {
    parts.push(`${summary.sleep.totalSleepHours.toFixed(1)}h sleep`);
  }
  if (summary.cycle?.kilojoule != null) {
    parts.push(`about ${Math.round(summary.cycle.kilojoule / 4.184)} kcal burned from WHOOP cycle`);
  }
  if (summary.workouts?.length) {
    const workoutStrain = summary.workouts
      .map((workout) => workout.strain)
      .filter((strain): strain is number => typeof strain === 'number')
      .reduce((total, strain) => total + strain, 0);
    parts.push(`${summary.workouts.length} workout${summary.workouts.length === 1 ? '' : 's'}${workoutStrain ? `, workout strain ${workoutStrain.toFixed(1)}` : ''}`);
  }

  return parts.length ? parts.join(', ') : null;
}

export type WhoopHomeInsight = { title: string; subtext: string };

// Home-page insight: a scannable action header + the raw WHOOP numbers underneath.
// Deterministic (not AI-generated) so the format/wording stays exact and instant.
export function whoopHomeInsight(
  summary: WhoopSummary | null | undefined,
  totals: Macros,
  targets: DailyTargets
): WhoopHomeInsight | null {
  if (!summary) return null;
  const recovery = summary.recovery?.score ?? null;
  const strain = summary.cycle?.strain ?? null;
  const sleepHours = summary.sleep?.totalSleepHours ?? null;
  const sleepPct = summary.sleep?.performancePercentage ?? null;
  if (recovery == null && strain == null) return null;

  const proteinRatio = targets.protein.max > 0 ? totals.protein / targets.protein.max : 1;
  const carbsRatio = targets.carbs.max > 0 ? totals.carbs / targets.carbs.max : 1;
  const title =
    proteinRatio <= carbsRatio ? 'A protein-forward meal would fit well today' : 'You have room for more carbs today';

  const subtextParts: string[] = [];
  if (recovery != null) subtextParts.push(`${Math.round(recovery)}% recovery`);
  if (strain != null) subtextParts.push(`${strain.toFixed(1)} strain`);
  if (sleepHours != null && sleepHours > 0) subtextParts.push(`${sleepHours.toFixed(1)}h sleep`);
  else if (sleepPct != null) subtextParts.push(`${Math.round(sleepPct)}% sleep`);

  return { title, subtext: subtextParts.join(' · ') };
}

export function whoopMealNudge(summary: WhoopSummary | null | undefined, meal: { protein: number; carbs: number; calories: number }): string | null {
  if (!summary) return null;
  const strain = summary.cycle?.strain ?? null;
  const recovery = summary.recovery?.score ?? null;
  const sleep = summary.sleep?.performancePercentage ?? null;

  if (strain != null && strain >= 14 && meal.carbs >= 35 && meal.protein >= 20) {
    return `WHOOP shows ${strain.toFixed(1)} strain today. Good fuel: carbs help refill energy, and ${Math.round(meal.protein)}g protein supports recovery.`;
  }
  if (strain != null && strain >= 14 && meal.carbs < 30) {
    return `WHOOP shows ${strain.toFixed(1)} strain today. Keep protein anchored, but add some carbs if you still feel under-fueled.`;
  }
  if (recovery != null && recovery < 45 && meal.protein < 20) {
    return `Recovery is low at ${Math.round(recovery)}%. Make the next meal protein-forward and easy to digest.`;
  }
  if (sleep != null && sleep < 70 && meal.calories > 500) {
    return `Sleep was lighter (${Math.round(sleep)}%). This meal is fine; keep the next one steady and protein-forward.`;
  }
  if (strain != null && strain < 8 && meal.calories > 650) {
    return `Low strain day (${strain.toFixed(1)}). This fits better if the rest of the day stays simple and protein anchored.`;
  }

  return null;
}
