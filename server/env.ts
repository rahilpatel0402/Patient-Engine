import "dotenv/config";

export const PORT = Number(process.env.PORT ?? 8787);

// First match wins. GEMINI_API_KEY is the documented name. The other two are
// accepted so a workshop key and a personal key can sit side by side in .env.
const KEY_NAMES = ["GEMINI_API_KEY", "Workshop_API_key", "Default_gemini_API_Key"] as const;

export function apiKeyName(): string | null {
  const forced = process.env.GEMINI_KEY_NAME?.trim();
  if (forced) return process.env[forced]?.trim() ? forced : null;
  return KEY_NAMES.find((name) => process.env[name]?.trim()) ?? null;
}

export function requireApiKey(): string {
  const name = apiKeyName();
  if (!name) {
    throw new Error("No Gemini API key found. Copy .env.example to .env and set GEMINI_API_KEY.");
  }
  return process.env[name]!.trim();
}

export function hasApiKey(): boolean {
  return apiKeyName() !== null;
}
