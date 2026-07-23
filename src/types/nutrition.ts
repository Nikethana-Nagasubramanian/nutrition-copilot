export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ParsedFoodItem extends Macros {
  name: string;
  confidence: 'high' | 'low';
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
