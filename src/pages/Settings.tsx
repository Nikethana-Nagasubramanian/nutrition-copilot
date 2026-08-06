import { useEffect, useState } from 'react';
import { getDailyTargets, getOllamaConfig, getWhoopConfig, setDailyTargets, setOllamaConfig, setWhoopConfig } from '../db/settings';
import { addDevLog, clearDevLogs, getDevLogs, type DevLogEntry } from '../services/devLogs';
import {
  buildWhoopAuthUrl,
  defaultWhoopRedirectUri,
  ensureWhoopAccess,
  exchangeWhoopCode,
  fetchWhoopSummary,
  makeWhoopState,
  WHOOP_SCOPES,
} from '../services/whoop';
import type { DailyTargets, OllamaConfig, WhoopConfig } from '../types/nutrition';

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

const FIELDS: { key: keyof DailyTargets; label: string; railLabel: string; unit: string; maxLimit: number; color: string }[] = [
  { key: 'calories', label: 'Calories', railLabel: 'CAL', unit: 'kcal', maxLimit: 3200, color: '#FC990099' },
  { key: 'protein', label: 'Protein', railLabel: 'PROTEIN', unit: 'g', maxLimit: 220, color: '#1B996699' },
  { key: 'carbs', label: 'Carbs', railLabel: 'CARB', unit: 'g', maxLimit: 360, color: '#2B7FFF99' },
  { key: 'fat', label: 'Fat', railLabel: 'FAT', unit: 'g', maxLimit: 140, color: '#8E51FF99' },
];

export default function Settings() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saved, setSaved] = useState(false);
  const [logs, setLogs] = useState<DevLogEntry[]>([]);
  const [ollama, setOllama] = useState<OllamaConfig>({
    enabled: false,
    baseUrl: '',
    model: 'llama3.1',
    timeoutMs: 20000,
  });
  const [whoop, setWhoop] = useState<WhoopConfig>({
    clientId: '',
    redirectUri: '',
    authState: '',
    authorizationCode: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: null,
    tokenType: 'bearer',
    scope: '',
    connectedAt: null,
    lastSyncAt: null,
    lastSummary: null,
  });
  const [ollamaSaved, setOllamaSaved] = useState(false);
  const [whoopSaved, setWhoopSaved] = useState(false);
  const [whoopMessage, setWhoopMessage] = useState<string | null>(null);
  const [whoopSyncing, setWhoopSyncing] = useState(false);
  const [ollamaTest, setOllamaTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    getDailyTargets().then((t) => {
      setForm({
        calories: { min: String(t.calories.min), max: String(t.calories.max) },
        protein: { min: String(t.protein.min), max: String(t.protein.max) },
        carbs: { min: String(t.carbs.min), max: String(t.carbs.max) },
        fat: { min: String(t.fat.min), max: String(t.fat.max) },
      });
    });
    getOllamaConfig().then(setOllama);
    getWhoopConfig().then(async (config) => {
      const nextConfig = { ...config, redirectUri: config.redirectUri || defaultWhoopRedirectUri() };
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      if (code && state && (!nextConfig.authState || state === nextConfig.authState)) {
        try {
          const connectedConfig = await exchangeWhoopCode({ ...nextConfig, authState: state }, code);
          setWhoop(connectedConfig);
          await setWhoopConfig(connectedConfig);
          setWhoopMessage('WHOOP connected. Sync when you want to pull today’s recovery/sleep/workout context.');
          window.history.replaceState({}, '', window.location.pathname);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'WHOOP token exchange failed.';
          setWhoopMessage(message);
          addDevLog({ level: 'error', source: 'WHOOP', message: 'Token exchange failed.', details: message });
        }
        return;
      }
      setWhoop(nextConfig);
    });
    setLogs(getDevLogs());
  }, []);

  const handleSaveOllama = async () => {
    await setOllamaConfig(ollama);
    setOllamaSaved(true);
    setTimeout(() => setOllamaSaved(false), 1500);
  };

  const handleSaveWhoop = async () => {
    await setWhoopConfig(whoop);
    setWhoopSaved(true);
    setTimeout(() => setWhoopSaved(false), 1500);
  };

  const handleConnectWhoop = async () => {
    const nextWhoop = {
      ...whoop,
      redirectUri: whoop.redirectUri || defaultWhoopRedirectUri(),
      authState: makeWhoopState(),
    };
    await setWhoopConfig(nextWhoop);
    window.location.href = buildWhoopAuthUrl(nextWhoop);
  };

  const handleSyncWhoop = async () => {
    setWhoopSyncing(true);
    setWhoopMessage(null);
    try {
      const authorized = await ensureWhoopAccess(whoop);
      const summary = await fetchWhoopSummary(authorized);
      const syncedConfig = {
        ...authorized,
        lastSummary: summary,
        lastSyncAt: new Date().toISOString(),
      };
      setWhoop(syncedConfig);
      await setWhoopConfig(syncedConfig);
      setWhoopMessage('WHOOP synced.');
      addDevLog({ level: 'info', source: 'WHOOP', message: 'WHOOP summary synced.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WHOOP sync failed.';
      setWhoopMessage(message);
      addDevLog({ level: 'error', source: 'WHOOP', message: 'WHOOP sync failed.', details: message });
    } finally {
      setWhoopSyncing(false);
    }
  };

  const handleTestOllama = async () => {
    setOllamaTest('testing');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ollama.timeoutMs);
      const res = await fetch(`${ollama.baseUrl.replace(/\/$/, '')}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      setOllamaTest(res.ok ? 'ok' : 'fail');
    } catch {
      setOllamaTest('fail');
    }
  };

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
    <div className="min-h-full bg-white">
      <div className="mx-auto max-w-md px-4 pb-28 pt-5">
      <h1 className="text-[2rem] font-bold leading-tight text-neutral-950">Preferences</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Set your macro ranges and tune the way Nutri works for you.
      </p>

      <div className="mt-4 space-y-1.5 rounded-lg bg-white">
        {FIELDS.map((field) => (
          <RangeSettingRow
            key={field.key}
            field={field}
            value={form[field.key]}
            onChange={(side, value) => updateField(field.key, side, value)}
          />
        ))}
      </div>

      <button
        className="mt-4 w-full rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white"
        onClick={handleSave}
      >
        {saved ? 'Saved!' : 'Save'}
      </button>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">WHOOP</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Connect recovery, strain, sleep, workouts, and body metrics as context for your meal plan.
        </p>

        <div className="mt-3 space-y-3 rounded-lg border border-neutral-200 bg-white p-3">
          <div className="rounded-lg bg-neutral-50 p-3 text-xs leading-5 text-neutral-600">
            <div><span className="font-semibold text-neutral-900">Redirect URL:</span> paste the exact value below into WHOOP.</div>
            <div><span className="font-semibold text-neutral-900">Privacy URL:</span> any public placeholder page you control is fine for dev.</div>
            <div><span className="font-semibold text-neutral-900">Server env:</span> add <span className="font-mono">WHOOP_CLIENT_SECRET</span> to your local <span className="font-mono">.env</span>.</div>
          </div>
          <div>
            <label className="text-xs font-semibold text-neutral-500">Client ID</label>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-3 text-base outline-none focus:border-neutral-400"
              placeholder="WHOOP Developer Dashboard client id"
              value={whoop.clientId}
              onChange={(event) => setWhoop((current) => ({ ...current, clientId: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-neutral-500">Redirect URL</label>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-3 text-base outline-none focus:border-neutral-400"
              value={whoop.redirectUri}
              onChange={(event) => setWhoop((current) => ({ ...current, redirectUri: event.target.value }))}
            />
          </div>
          <div className="rounded-lg bg-neutral-50 p-3">
            <div className="text-[10px] font-bold uppercase text-neutral-400">Scopes</div>
            <p className="mt-1 text-xs leading-5 text-neutral-600">{WHOOP_SCOPES.join(' · ')}</p>
          </div>
          {whoop.connectedAt && (
            <p className="rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
              Connected at {new Date(whoop.connectedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
            </p>
          )}
          {whoop.lastSummary && <WhoopSummaryCard whoop={whoop} />}
          {whoopMessage && <p className="text-xs font-medium leading-5 text-amber-700">{whoopMessage}</p>}
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-lg bg-neutral-100 py-3 text-sm font-semibold text-neutral-800"
              onClick={handleSaveWhoop}
            >
              {whoopSaved ? 'Saved!' : 'Save'}
            </button>
            <button
              className="flex-1 rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white disabled:opacity-50"
              onClick={handleConnectWhoop}
              disabled={!whoop.clientId || !(whoop.redirectUri || defaultWhoopRedirectUri())}
            >
              Connect WHOOP
            </button>
          </div>
          <button
            className="w-full rounded-lg border border-neutral-200 bg-white py-3 text-sm font-semibold text-neutral-900 disabled:opacity-50"
            onClick={handleSyncWhoop}
            disabled={!whoop.accessToken || whoopSyncing}
          >
            {whoopSyncing ? 'Syncing WHOOP...' : 'Sync WHOOP context'}
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">AI Backend</h2>
        <p className="mt-1 text-xs text-neutral-500">
          If enabled, meal parsing tries your local Ollama server first (over Tailscale) and falls back to the
          cloud automatically when it's unreachable.
        </p>

        <div className="mt-3 space-y-3 rounded-[1.5rem] bg-white p-4 shadow-sm shadow-neutral-200/70">
          <label className="flex items-center justify-between text-sm font-semibold text-neutral-900">
            Use local Ollama first
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={ollama.enabled}
              onChange={(e) => setOllama((o) => ({ ...o, enabled: e.target.checked }))}
            />
          </label>

          <div>
            <label className="text-xs font-semibold text-neutral-500">Ollama base URL (Tailscale)</label>
            <input
              className="mt-1 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base outline-none focus:border-green-500"
              placeholder="https://your-desktop.tailXXXX.ts.net"
              value={ollama.baseUrl}
              onChange={(e) => setOllama((o) => ({ ...o, baseUrl: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-500">Model name</label>
            <input
              className="mt-1 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base outline-none focus:border-green-500"
              placeholder="llama3.1"
              value={ollama.model}
              onChange={(e) => setOllama((o) => ({ ...o, model: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-neutral-500">Timeout (ms)</label>
            <input
              className="mt-1 w-full rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base outline-none focus:border-green-500"
              inputMode="numeric"
              placeholder="20000"
              value={String(ollama.timeoutMs)}
              onChange={(e) => setOllama((o) => ({ ...o, timeoutMs: Number(e.target.value) || 0 }))}
            />
            <p className="mt-1 text-[11px] text-neutral-400">
              How long to wait for Ollama before falling back to the cloud. Raise this if the model needs to cold-load
              (e.g. 20000 = 20s).
            </p>
          </div>

          <div className="flex gap-2">
            <button
              className="flex-1 rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white"
              onClick={handleSaveOllama}
            >
              {ollamaSaved ? 'Saved!' : 'Save'}
            </button>
            <button
              className="flex-1 rounded-2xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
              onClick={handleTestOllama}
              disabled={!ollama.baseUrl || ollamaTest === 'testing'}
            >
              {ollamaTest === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
          </div>

          {ollamaTest === 'ok' && <p className="text-xs font-semibold text-green-600">Reachable ✓</p>}
          {ollamaTest === 'fail' && (
            <p className="text-xs font-semibold text-red-600">
              Couldn't reach it. Check Tailscale is on for both devices and Ollama is running.
            </p>
          )}
        </div>
      </section>

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
                    <div className="text-xs font-semibold uppercase text-red-600">
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
    </div>
  );
}

function WhoopSummaryCard({ whoop }: { whoop: WhoopConfig }) {
  const summary = whoop.lastSummary;
  if (!summary) return null;

  const caloriesBurned = summary.cycle?.kilojoule ? Math.round(summary.cycle.kilojoule / 4.184) : null;
  const workoutCount = summary.workouts?.length ?? 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase text-neutral-400">Latest WHOOP context</div>
          {whoop.lastSyncAt && (
            <div className="mt-1 text-[11px] text-neutral-400">
              Synced {new Date(whoop.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
        {summary.profile?.firstName && (
          <div className="text-right text-xs font-semibold text-neutral-700">{summary.profile.firstName}</div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <WhoopMetric label="Strain" value={formatOptional(summary.cycle?.strain, 1)} />
        <WhoopMetric label="Recovery" value={summary.recovery?.score == null ? '—' : `${Math.round(summary.recovery.score)}%`} />
        <WhoopMetric label="Sleep" value={summary.sleep?.performancePercentage == null ? '—' : `${Math.round(summary.sleep.performancePercentage)}%`} />
        <WhoopMetric label="Burned" value={caloriesBurned == null ? '—' : `${caloriesBurned} kcal`} />
      </div>

      <p className="mt-3 text-xs leading-5 text-neutral-500">
        {workoutCount > 0
          ? `${workoutCount} workout${workoutCount === 1 ? '' : 's'} found in the last day.`
          : 'No workout found in the last day.'}
      </p>
    </div>
  );
}

function WhoopMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-2">
      <div className="text-[10px] font-bold uppercase text-neutral-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-neutral-950">{value}</div>
    </div>
  );
}

function formatOptional(value: number | null | undefined, digits = 0) {
  return value == null ? '—' : value.toFixed(digits);
}

function RangeSettingRow({
  field,
  value,
  onChange,
}: {
  field: { label: string; railLabel: string; unit: string; maxLimit: number; color: string };
  value: RangeFields;
  onChange: (side: 'min' | 'max', value: string) => void;
}) {
  const minValue = Number(value.min) || 0;
  const maxValue = Math.max(Number(value.max) || 0, minValue);
  const maxLimit = Math.max(field.maxLimit, maxValue, 1);
  const minPosition = Math.min(100, Math.max(0, (minValue / maxLimit) * 100));
  const maxPosition = Math.min(100, Math.max(0, (maxValue / maxLimit) * 100));

  const updateMin = (next: string) => {
    const numeric = Number(next) || 0;
    onChange('min', String(Math.min(numeric, maxValue)));
  };

  const updateMax = (next: string) => {
    const numeric = Number(next) || 0;
    onChange('max', String(Math.max(numeric, minValue)));
  };

  return (
    <div className="flex h-8 items-center gap-1.5">
      <div className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-lg bg-black/[0.04]">
        <div className="absolute inset-0">
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((tick) => (
            <span
              key={tick}
              className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/[0.06]"
              style={{ left: `${tick}%` }}
            />
          ))}
          <div
            className="absolute inset-y-0 rounded-lg"
            style={{ left: `${minPosition}%`, width: `${Math.max(3, maxPosition - minPosition)}%`, backgroundColor: field.color }}
          />
        </div>
        <div
          className="pointer-events-none absolute top-2 h-[17px] w-px rounded-full bg-[#dbdbdb]"
          style={{ left: `${minPosition}%` }}
        />
        <div
          className="pointer-events-none absolute top-2 h-[17px] w-px rounded-full bg-[#dbdbdb]"
          style={{ left: `${maxPosition}%` }}
        />
        <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase leading-none text-black">
          {field.railLabel}
        </div>
        <input
          className="range-slider-thumb range-slider-max absolute inset-0 z-30 h-full w-full cursor-ew-resize appearance-none bg-transparent"
          type="range"
          min={0}
          max={maxLimit}
          step={field.unit === 'kcal' ? 25 : 1}
          aria-label={`${field.label} maximum`}
          value={maxValue}
          onChange={(event) => updateMax(event.target.value)}
        />
        <input
          className="range-slider-thumb range-slider-min absolute inset-0 z-20 h-full w-full cursor-ew-resize appearance-none bg-transparent"
          type="range"
          min={0}
          max={maxLimit}
          step={field.unit === 'kcal' ? 25 : 1}
          aria-label={`${field.label} minimum`}
          value={minValue}
          onChange={(event) => updateMin(event.target.value)}
        />
      </div>

      <input
        className="h-8 w-12 shrink-0 rounded-lg bg-black/[0.04] px-1.5 text-right text-black/95 outline-none transition focus:bg-black/[0.07]"
        inputMode="numeric"
        aria-label={`${field.label} minimum value`}
        value={value.min}
        onChange={(event) => updateMin(event.target.value)}
        style={{
          fontFamily: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: '10px',
          fontWeight: 400,
          lineHeight: '100%',
        }}
      />
      <input
        className="h-8 w-12 shrink-0 rounded-lg bg-black/[0.04] px-1.5 text-right text-black/95 outline-none transition focus:bg-black/[0.07]"
        inputMode="numeric"
        aria-label={`${field.label} maximum value`}
        value={value.max}
        onChange={(event) => updateMax(event.target.value)}
        style={{
          fontFamily: 'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: '10px',
          fontWeight: 400,
          lineHeight: '100%',
        }}
      />
    </div>
  );
}
