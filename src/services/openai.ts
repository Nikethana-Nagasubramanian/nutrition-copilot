import type { AskNutritionResult, ParsedMeal } from '../types/nutrition';
import { addDevLog } from './devLogs';
import { getOllamaConfig } from '../db/settings';

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined;
const MODEL = 'claude-haiku-4-5-20251001';
const USE_DIRECT_BROWSER_API = Boolean(import.meta.env.DEV && API_KEY);

const MEAL_SYSTEM_PROMPT = `You are a nutrition estimation assistant. Estimate calories and macros from natural language descriptions of food.

Rules:
1. Use conservative estimates.
   - Never overestimate protein. If uncertain, use the lower bound of a reasonable protein range.
   - Never underestimate calories. If uncertain, use the upper-reasonable bound of a reasonable calorie range.
2. Scale quantities linearly with portion size (e.g. if 3/4 cup is 80 kcal / 8g protein, 1/2 cup is 53 kcal / 5.3g protein).
3. If the user provides specific nutrition-label or manufacturer numbers, those override your generic estimate entirely.
4. Never invent ingredients. If the user doesn't mention cheese, oil, butter, dressing, etc., do not add it or its calories.
   If a common version of this dish usually includes such an ingredient, say so in a note instead of assuming it's present.
5. If a portion is vague ("a handful", "a bowl", "a spoon"), use a common serving size and reflect that with lower confidence.
6. Do not lecture about healthy eating. Return estimates only.
7. Do not double count ingredients that appear in multiple foods.
8. Confidence per item: "high" (exact label/brand given), "medium" (common, well-defined serving), "low" (multiple assumptions required).
9. Prioritize consistency: the same meal description should produce nearly identical numbers every time. Do not vary your estimate for its own sake.
10. Respond ONLY with valid JSON matching this exact shape, no prose, no markdown fences:
{
  "foods": [
    { "name": string, "quantity": string, "calories": number, "protein": number, "carbs": number, "fat": number, "confidence": "high" | "medium" | "low" }
  ],
  "totals": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "lowConfidenceNote": string | null
}
Set lowConfidenceNote to a short (<20 words) note if any item is medium/low confidence or an ingredient was assumed absent, explaining what's uncertain. Otherwise null.`;

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
  const content = await getCompletion({
    source: 'parseMealDescription',
    maxTokens: 900,
    system: MEAL_SYSTEM_PROMPT,
    user: description,
  });

  const parsed = extractJson(content) as ParsedMeal;
  if (!parsed.foods || !parsed.totals) throw new Error('AI response was missing expected fields.');
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
  const content = await getCompletion({
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

  const parsed = extractJson(content) as AskNutritionResult;
  if (!parsed.verdict || !parsed.adds || !parsed.newTotals || !parsed.remaining) {
    throw new Error('AI response was missing expected ask fields.');
  }
  return parsed;
}

/**
 * Tries the user's Ollama server first (if configured and reachable), and
 * falls back to the Anthropic API. Returns the raw text content from
 * whichever backend answered.
 */
async function getCompletion({
  source,
  maxTokens,
  system,
  user,
}: {
  source: string;
  maxTokens: number;
  system: string;
  user: string;
}): Promise<string> {
  const ollamaConfig = await getOllamaConfig();

  if (ollamaConfig.enabled && ollamaConfig.baseUrl) {
    try {
      const content = await callOllama({ source, system, user, config: ollamaConfig });
      if (content) return content;
    } catch (err) {
      addDevLog({
        level: 'warn',
        source,
        message: 'Ollama unreachable or failed, falling back to Anthropic.',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  }

  requireApiKey();
  const data = await callAnthropic({ source, maxTokens, system, user });
  const content = extractAnthropicText(data);
  if (!content) throw new Error('Anthropic returned an empty response.');
  return content;
}

async function callOllama({
  source,
  system,
  user,
  config,
}: {
  source: string;
  system: string;
  user: string;
  config: { baseUrl: string; model: string; timeoutMs: number };
}): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    const content = data?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Ollama returned an empty response.');
    }
    addDevLog({ level: 'info', source, message: 'Used local Ollama for this request.' });
    return content;
  } finally {
    clearTimeout(timeout);
  }
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
    temperature: 0,
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
