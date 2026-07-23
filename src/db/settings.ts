import { getDb } from './database';
import type { DailyTargets } from '../types/nutrition';

const TARGETS_KEY = 'dailyTargets';

const DEFAULT_TARGETS: DailyTargets = {
  calories: { min: 1700, max: 2000 },
  protein: { min: 90, max: 130 },
  carbs: { min: 150, max: 220 },
  fat: { min: 50, max: 80 },
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
