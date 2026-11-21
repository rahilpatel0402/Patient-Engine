import "dotenv/config";

export const PORT = Number(process.env.PORT ?? 8787);

// Two keys can sit side by side in .env. Each is its own quota pool.
//   batch: patient sets, the three arms, the grader, the stress ladder
//   live:  the mic path used in front of judges, so a batch run can never starve it
// Either role falls back to the other key when its own key is missing or rate limited.
// GEMINI_API_KEY, the documented name, is used for both roles if it is the only one set.
const ROLE_KEYS = {
  batch: ["Workshop_API_key", "GEMINI_API_KEY", "Default_gemini_API_Key"],
  live: ["Default_gemini_API_Key", "GEMINI_API_KEY", "Workshop_API_key"],
} as const;

export type KeyRole = keyof typeof ROLE_KEYS;

/** Key names for a role, best first, limited to the ones that are set. */
export function keyNames(role: KeyRole = "batch"): string[] {
  return ROLE_KEYS[role].filter((name) => process.env[name]?.trim());
}

export function keyValue(name: string): string {
  return process.env[name]!.trim();
}

export function requireApiKey(role: KeyRole = "batch"): string {
  const [name] = keyNames(role);
  if (!name) throw new Error("No Gemini API key found. Copy .env.example to .env and set GEMINI_API_KEY.");
  return keyValue(name);
}

export function apiKeyName(role: KeyRole = "batch"): string | null {
  return keyNames(role)[0] ?? null;
}

export function hasApiKey(): boolean {
  return keyNames("batch").length > 0;
}
