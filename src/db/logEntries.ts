import { getDb, newId } from './database';
import type { LoggedEntry, Macros } from '../types/nutrition';

export function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function addLoggedEntry(
  description: string,
  macros: Macros,
  sourceMealId: string | null = null,
  dateKey: string = todayKey()
): Promise<LoggedEntry> {
  const db = await getDb();
  const entry: LoggedEntry = {
    id: newId(),
    loggedAt: new Date().toISOString(),
    dateKey,
    description,
    sourceMealId,
    ...macros,
  };
  await db.add('entries', entry);
  return entry;
}

export async function getEntriesForDate(dateKey: string = todayKey()): Promise<LoggedEntry[]> {
  const db = await getDb();
  const entries = await db.getAllFromIndex('entries', 'dateKey', dateKey);
  return entries.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}

export async function getTotalsForDate(dateKey: string = todayKey()): Promise<Macros> {
  const entries = await getEntriesForDate(dateKey);
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export async function deleteLoggedEntry(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('entries', id);
}
