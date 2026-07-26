export interface DevLogEntry {
  id: string;
  createdAt: string;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  details?: string;
}

const KEY = 'nutrition-copilot.devLogs';
const MAX_LOGS = 50;

export function getDevLogs(): DevLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addDevLog(entry: Omit<DevLogEntry, 'id' | 'createdAt'>) {
  const next: DevLogEntry = {
    ...entry,
    id: makeId(),
    createdAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(KEY, JSON.stringify([next, ...getDevLogs()].slice(0, MAX_LOGS)));
  } catch {
    // If storage is unavailable, avoid creating a second error while reporting the first one.
  }
}

export function clearDevLogs() {
  localStorage.removeItem(KEY);
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
