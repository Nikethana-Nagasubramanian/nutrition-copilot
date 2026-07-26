import type { AskNutritionResult, ParsedMeal } from '../types/nutrition';
import { addDevLog } from './devLogs';

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
const MODEL = 'claude-haiku-4-5-20251001';
const USE_DIRECT_BROWSER_API = Boolean(import.meta.env.DEV && API_KEY);

const MEAL_SYSTEM_PROMPT = `You are a nutrition estimation assistant for a personal calorie-tracking app.
The user will describe what they ate in casual, imprecise language.

Rules:
- Always estimate conservatively.
- Never overestimate protein. If uncertain, use the lower bound of a reasonable protein range.
- Never underestimate calories. If uncertain, use the upper-reasonable bound of a reasonable calorie range.
- Break the meal into individual food items.
- Mark each item's confidence as "low" if the description was vague or "high" if it was specific.
- Respond ONLY with valid JSON matching this exact shape, no prose, no markdown fences:
{
  "foods": [
    { "name": string, "calories": number, "protein": number, "carbs": number, "fat": number, "confidence": "high" | "low" }
  ],
  "totals": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "lowConfidenceNote": string | null
}
Set lowConfidenceNote to a short (<20 words) note if any item has low confidence, explaining what's uncertain. Otherwise null.`;

function requireApiKey() {
  if (!USE_DIRECT_BROWSER_API && import.meta.env.DEV) {
    addDevLog({
      level: 'error',
      source: 'anthropic.config',
      message: 'VITE_ANTHROPIC_API_KEY is not set.',
    });
    throw new Error('VITE_ANTHROPIC_API_KEY is not set. Add it to your .env file.');
  }
}

function extractJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '');
  return JSON.parse(cleaned);
}

export async function parseMealDescription(description: string): Promise<ParsedMeal> {
  requireApiKey();

  const data = await callAnthropic({
    source: 'parseMealDescription',
    maxTokens: 900,
    system: MEAL_SYSTEM_PROMPT,
    user: description,
  });

  const content = extractAnthropicText(data);
  if (!content) throw new Error('Anthropic returned an empty response.');

  const parsed = extractJson(content) as ParsedMeal;
  if (!parsed.foods || !parsed.totals) throw new Error('Anthropic response was missing expected fields.');
  return parsed;
}

export async function parseMealFromAudio(audioBlob: Blob): Promise<ParsedMeal> {
  void audioBlob;
  addDevLog({
    level: 'warn',
    source: 'parseMealFromAudio',
    message: 'Audio parsing is disabled in Anthropic browser mode.',
  });
  throw new Error('Audio parsing is disabled. Use iPhone dictation in the text box instead.');
}

export async function askNutritionQuestion(
  question: string,
  todayTotals: string,
  targets: string
): Promise<AskNutritionResult> {
  requireApiKey();

  const data = await callAnthropic({
    source: 'askNutritionQuestion',
    maxTokens: 700,
    system: `You are a precise nutrition calculator for a personal tracker.
Rules:
- If the user asks about a food without quantity, assume exactly one standard serving or one standard package.
- Do not assume extra servings, add-ons, eggs, sides, or toppings unless named.
- Estimate conservatively: never overestimate protein, never underestimate calories.
- Suggestions are allowed, but keep them short and directly tied to the user's remaining macros.
- Return ONLY valid JSON matching this exact shape, no prose, no markdown fences:
{
  "verdict": "yes" | "caution" | "no",
  "assumption": string,
  "foodName": string,
  "adds": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "newTotals": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "remaining": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "summary": string,
  "suggestion": string | null
}
Summary must be one short sentence. Remaining values may be negative when over target.`,
    user: `Today so far: ${todayTotals}\nDaily targets: ${targets}\nQuestion: ${question}`,
  });

  const content = extractAnthropicText(data);
  if (!content) throw new Error('Anthropic returned an empty response.');
  const parsed = extractJson(content) as AskNutritionResult;
  if (!parsed.verdict || !parsed.adds || !parsed.newTotals || !parsed.remaining) {
    throw new Error('Anthropic response was missing expected ask fields.');
  }
  return parsed;
}

async function callAnthropic({
  source,
  maxTokens,
  system,
  user,
}: {
  source: string;
  maxTokens: number;
  system: string;
  user: string;
}) {
  const payload = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };

  const response = USE_DIRECT_BROWSER_API ? await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  }) : await fetch('/api/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    const message = `Anthropic request failed (${response.status})`;
    addDevLog({
      level: 'error',
      source,
      message,
      details: JSON.stringify(
        {
          status: response.status,
          statusText: response.statusText,
          model: MODEL,
          body: safeParseJson(body) ?? body,
        },
        null,
        2
      ),
    });
    throw new Error(`${message}: ${body}`);
  }

  return response.json();
}

function extractAnthropicText(data: any): string | null {
  const content = data?.content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();

  return text || null;
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
