import { useEffect, useState } from 'react';
import { getDailyTargets, setDailyTargets } from '../db/settings';
import { clearDevLogs, getDevLogs, type DevLogEntry } from '../services/devLogs';
import type { DailyTargets } from '../types/nutrition';

interface RangeFields {
  min: string;
  max: string;
}

type FormState = Record<keyof DailyTargets, RangeFields>;

const emptyRange: RangeFields = { min: '', max: '' };
const emptyForm: FormState = {
  calories: emptyRange,
  protein: emptyRange,
  carbs: emptyRange,
  fat: emptyRange,
};

const FIELDS: { key: keyof DailyTargets; label: string }[] = [
  { key: 'calories', label: 'Calories' },
  { key: 'protein', label: 'Protein (g)' },
  { key: 'carbs', label: 'Carbs (g)' },
  { key: 'fat', label: 'Fat (g)' },
];

export default function Settings() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saved, setSaved] = useState(false);
  const [logs, setLogs] = useState<DevLogEntry[]>([]);

  useEffect(() => {
    getDailyTargets().then((t) => {
      setForm({
        calories: { min: String(t.calories.min), max: String(t.calories.max) },
        protein: { min: String(t.protein.min), max: String(t.protein.max) },
        carbs: { min: String(t.carbs.min), max: String(t.carbs.max) },
        fat: { min: String(t.fat.min), max: String(t.fat.max) },
      });
    });
    setLogs(getDevLogs());
  }, []);

  const updateField = (key: keyof DailyTargets, side: 'min' | 'max', value: string) => {
    setForm((f) => ({ ...f, [key]: { ...f[key], [side]: value } }));
  };

  const handleSave = async () => {
    const targets: DailyTargets = {
      calories: { min: Number(form.calories.min) || 0, max: Number(form.calories.max) || 0 },
      protein: { min: Number(form.protein.min) || 0, max: Number(form.protein.max) || 0 },
      carbs: { min: Number(form.carbs.min) || 0, max: Number(form.carbs.max) || 0 },
      fat: { min: Number(form.fat.min) || 0, max: Number(form.fat.max) || 0 },
    };
    await setDailyTargets(targets);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-5">
      <h1 className="text-[2rem] font-bold leading-tight tracking-normal text-neutral-950">Settings</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Set a range instead of an exact number if you're not sure yet.
      </p>

      <div className="mt-6 space-y-4 rounded-[1.5rem] bg-white p-4 shadow-sm shadow-neutral-200/70">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs font-semibold text-neutral-500">{label}</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base outline-none focus:border-green-500"
                inputMode="numeric"
                placeholder="Min"
                value={form[key].min}
                onChange={(e) => updateField(key, 'min', e.target.value)}
              />
              <span className="text-sm text-neutral-400">–</span>
              <input
                className="w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base outline-none focus:border-green-500"
                inputMode="numeric"
                placeholder="Max"
                value={form[key].max}
                onChange={(e) => updateField(key, 'max', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        className="mt-4 w-full rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white"
        onClick={handleSave}
      >
        {saved ? 'Saved!' : 'Save'}
      </button>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">Developer Logs</h2>
          <div className="flex gap-2">
            <button
              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-sm shadow-neutral-200/70"
              onClick={() => setLogs(getDevLogs())}
            >
              Refresh
            </button>
            <button
              className="rounded-xl bg-neutral-900 px-3 py-2 text-xs font-semibold text-white"
              onClick={() => {
                clearDevLogs();
                setLogs([]);
              }}
            >
              Clear
            </button>
          </div>
        </div>

        {logs.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-white p-4 text-sm text-neutral-500 shadow-sm shadow-neutral-200/70">
            No logs yet. Trigger the AI issue once, then come back here.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {logs.map((log) => (
              <article key={log.id} className="rounded-2xl bg-white p-4 shadow-sm shadow-neutral-200/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-red-600">
                      {log.level} · {log.source}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-neutral-900">{log.message}</div>
                  </div>
                  <time className="shrink-0 text-right text-[11px] text-neutral-400">
                    {new Date(log.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </time>
                </div>
                {log.details && (
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-neutral-950 p-3 text-[11px] leading-4 text-neutral-100">
                    {log.details}
                  </pre>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
