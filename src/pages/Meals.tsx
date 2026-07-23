import { useEffect, useState } from 'react';
import {
  createRecurringMeal,
  deleteRecurringMeal,
  getAllRecurringMeals,
  updateRecurringMeal,
} from '../db/recurringMeals';
import { addLoggedEntry } from '../db/logEntries';
import type { RecurringMeal } from '../types/nutrition';

interface FormState {
  id: string | null;
  name: string;
  description: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  description: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
};

export default function Meals() {
  const [meals, setMeals] = useState<RecurringMeal[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = async () => setMeals(await getAllRecurringMeals());

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  const openCreate = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (meal: RecurringMeal) => {
    setForm({
      id: meal.id,
      name: meal.name,
      description: meal.description,
      calories: String(meal.calories),
      protein: String(meal.protein),
      carbs: String(meal.carbs),
      fat: String(meal.fat),
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const macros = {
      calories: Number(form.calories) || 0,
      protein: Number(form.protein) || 0,
      carbs: Number(form.carbs) || 0,
      fat: Number(form.fat) || 0,
    };
    if (form.id) {
      await updateRecurringMeal(form.id, form.name.trim(), form.description.trim(), macros);
    } else {
      await createRecurringMeal(form.name.trim(), form.description.trim(), macros);
    }
    setFormOpen(false);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteRecurringMeal(id);
    await refresh();
  };

  const handleLogNow = async (meal: RecurringMeal) => {
    await addLoggedEntry(meal.name, meal, meal.id);
    setToast(`${meal.name} logged`);
  };

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900">Recurring Meals</h1>
        <button
          className="rounded-xl bg-green-600 px-3 py-1.5 text-sm font-semibold text-white"
          onClick={openCreate}
        >
          + Add
        </button>
      </div>

      {meals.length === 0 ? (
        <p className="mt-8 text-center text-sm text-neutral-400">
          No recurring meals yet. Add ones you eat often to log them instantly, no AI call needed.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {meals.map((meal) => (
            <li key={meal.id} className="flex items-center gap-3 rounded-2xl bg-neutral-100 p-4">
              <button className="min-w-0 flex-1 text-left" onClick={() => openEdit(meal)}>
                <div className="truncate text-sm font-semibold text-neutral-900">{meal.name}</div>
                {meal.description && (
                  <div className="truncate text-xs text-neutral-500">{meal.description}</div>
                )}
                <div className="mt-1 text-xs text-neutral-500">
                  {Math.round(meal.calories)} kcal · {Math.round(meal.protein)}g protein · {Math.round(meal.carbs)}g carbs · {Math.round(meal.fat)}g fat
                </div>
              </button>
              <div className="flex flex-col items-end gap-2">
                <button
                  className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white"
                  onClick={() => handleLogNow(meal)}
                >
                  Log
                </button>
                <button className="text-xs font-medium text-red-600" onClick={() => handleDelete(meal.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white">
          {toast}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setFormOpen(false)}>
          <div
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-neutral-900">{form.id ? 'Edit Meal' : 'New Meal'}</h2>

            <input
              className="mt-4 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm"
              placeholder="Name (e.g. Protein Shake)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <textarea
              className="mt-3 w-full resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm"
              rows={3}
              placeholder="Description (e.g. 1.5 scoop whey, 2 tbsp yogurt...)"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                className="rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Calories"
                inputMode="numeric"
                value={form.calories}
                onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value }))}
              />
              <input
                className="rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Protein (g)"
                inputMode="numeric"
                value={form.protein}
                onChange={(e) => setForm((f) => ({ ...f, protein: e.target.value }))}
              />
              <input
                className="rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Carbs (g)"
                inputMode="numeric"
                value={form.carbs}
                onChange={(e) => setForm((f) => ({ ...f, carbs: e.target.value }))}
              />
              <input
                className="rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                placeholder="Fat (g)"
                inputMode="numeric"
                value={form.fat}
                onChange={(e) => setForm((f) => ({ ...f, fat: e.target.value }))}
              />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 rounded-xl bg-neutral-200 py-2.5 text-sm font-semibold text-neutral-700"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-xl bg-green-600 py-2.5 text-sm font-semibold text-white"
                onClick={handleSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
