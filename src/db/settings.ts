import { getDb } from './database';
import type { DailyTargets, OllamaConfig, WhoopConfig } from '../types/nutrition';

const TARGETS_KEY = 'dailyTargets';
const OLLAMA_KEY = 'ollamaConfig';
const WHOOP_KEY = 'whoopConfig';

const DEFAULT_TARGETS: DailyTargets = {
  calories: { min: 1700, max: 2000 },
  protein: { min: 90, max: 130 },
  carbs: { min: 150, max: 220 },
  fat: { min: 50, max: 80 },
};

const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  enabled: false,
  baseUrl: '',
  model: 'llama3.1',
  timeoutMs: 20000,
};

const DEFAULT_WHOOP_CONFIG: WhoopConfig = {
  clientId: '',
  redirectUri: '',
  authState: '',
  authorizationCode: '',
  connectedAt: null,
};

export async function getDailyTargets(): Promise<DailyTargets> {
  const db = await getDb();
  const value = await db.get('settings', TARGETS_KEY);
  if (!value) return DEFAULT_TARGETS;
  return { ...DEFAULT_TARGETS, ...(value as DailyTargets) };
}

export async function setDailyTargets(targets: DailyTargets): Promise<void> {
  const db = await getDb();
  await db.put('settings', targets, TARGETS_KEY);
}

export async function getOllamaConfig(): Promise<OllamaConfig> {
  const db = await getDb();
  const value = await db.get('settings', OLLAMA_KEY);
  if (!value) return DEFAULT_OLLAMA_CONFIG;
  return { ...DEFAULT_OLLAMA_CONFIG, ...(value as OllamaConfig) };
}

export async function setOllamaConfig(config: OllamaConfig): Promise<void> {
  const db = await getDb();
  await db.put('settings', config, OLLAMA_KEY);
}

export async function getWhoopConfig(): Promise<WhoopConfig> {
  const db = await getDb();
  const value = await db.get('settings', WHOOP_KEY);
  if (!value) return DEFAULT_WHOOP_CONFIG;
  return { ...DEFAULT_WHOOP_CONFIG, ...(value as WhoopConfig) };
}

export async function setWhoopConfig(config: WhoopConfig): Promise<void> {
  const db = await getDb();
  await db.put('settings', config, WHOOP_KEY);
}
