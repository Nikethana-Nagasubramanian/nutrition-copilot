import { getDb, newId } from './database';
import type { Macros, RecurringMeal } from '../types/nutrition';

export async function getAllRecurringMeals(): Promise<RecurringMeal[]> {
  const db = await getDb();
  const meals = await db.getAll('recurringMeals');
  return meals.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createRecurringMeal(
  name: string,
  description: string,
  macros: Macros
): Promise<RecurringMeal> {
  const db = await getDb();
  const meal: RecurringMeal = {
    id: newId(),
    name,
    description,
    createdAt: new Date().toISOString(),
    ...macros,
  };
  await db.add('recurringMeals', meal);
  return meal;
}

export async function updateRecurringMeal(
  id: string,
  name: string,
  description: string,
  macros: Macros
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('recurringMeals', id);
  if (!existing) return;
  await db.put('recurringMeals', { ...existing, name, description, ...macros });
}

export async function deleteRecurringMeal(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('recurringMeals', id);
}

export async function findRecurringMealByName(name: string): Promise<RecurringMeal | undefined> {
  const db = await getDb();
  const meals = await db.getAllFromIndex('recurringMeals', 'name');
  return meals.find((m) => m.name.toLowerCase() === name.toLowerCase());
}
