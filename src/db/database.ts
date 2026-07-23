import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LoggedEntry, RecurringMeal } from '../types/nutrition';

interface NutritionDB extends DBSchema {
  entries: {
    key: string;
    value: LoggedEntry;
    indexes: { dateKey: string };
  };
  recurringMeals: {
    key: string;
    value: RecurringMeal;
    indexes: { name: string };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<NutritionDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<NutritionDB>('nutrition-copilot', 1, {
      upgrade(db) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('dateKey', 'dateKey');

        const meals = db.createObjectStore('recurringMeals', { keyPath: 'id' });
        meals.createIndex('name', 'name', { unique: true });

        db.createObjectStore('settings');
      },
    });
  }
  return dbPromise;
}

export function newId(): string {
  return crypto.randomUUID();
}
