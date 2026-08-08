export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ParsedFoodItem extends Macros {
  name: string;
  quantity?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ParsedMeal {
  foods: ParsedFoodItem[];
  totals: Macros;
  lowConfidenceNote?: string | null;
}

export interface LoggedEntry extends Macros {
  id: string;
  loggedAt: string; // ISO timestamp
  dateKey: string; // YYYY-MM-DD, local day this entry counts toward
  description: string;
  sourceMealId: string | null;
}

export interface RecurringMeal extends Macros {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface MacroRange {
  min: number;
  max: number;
}

export interface DailyTargets {
  calories: MacroRange;
  protein: MacroRange;
  carbs: MacroRange;
  fat: MacroRange;
}

export interface AskNutritionResult {
  verdict: 'yes' | 'caution' | 'no';
  assumption: string;
  foodName: string;
  adds: Macros;
  newTotals: Macros;
  remaining: Macros;
  recommendationTitle: string;
  recommendation: string;
  whoopTitle?: string | null;
  whoopInsight?: string | null;
}

export interface OllamaConfig {
  enabled: boolean;
  baseUrl: string; // e.g. https://desktop.tailXXXX.ts.net or http://100.x.y.z:11434
  model: string; // e.g. llama3.1
  timeoutMs: number;
}

export interface WhoopConfig {
  clientId: string;
  redirectUri: string;
  authState: string;
  authorizationCode: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  tokenType: string;
  scope: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSummary: WhoopSummary | null;
}

export interface WhoopSummary {
  profile?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
  cycle?: {
    strain?: number | null;
    kilojoule?: number | null;
    averageHeartRate?: number | null;
    maxHeartRate?: number | null;
  } | null;
  recovery?: {
    score?: number | null;
    hrvRmssdMilli?: number | null;
    restingHeartRate?: number | null;
    spo2Percentage?: number | null;
  } | null;
  sleep?: {
    performancePercentage?: number | null;
    efficiencyPercentage?: number | null;
    consistencyPercentage?: number | null;
    totalSleepHours?: number | null;
  } | null;
  workouts?: Array<{
    sportName?: string | null;
    strain?: number | null;
    kilojoule?: number | null;
    averageHeartRate?: number | null;
  }>;
}
