// Disk cache for model results, keyed by a hash of the inputs.
// A rate limit or a crash never loses a finished call.
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, "cache");

export function sha(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function fileSha(file: string): string {
  return sha(fs.readFileSync(file));
}

export type Cached<T> = { value: T; ms: number; cached: boolean };

/** `fn` reports its own duration, so time spent queued behind the concurrency limit is not counted. */
export async function cached<T>(kind: string, key: unknown, fn: () => Promise<{ value: T; ms: number }>): Promise<Cached<T>> {
  const hash = sha(JSON.stringify({ kind, key })).slice(0, 24);
  const file = path.join(CACHE_DIR, kind, `${hash}.json`);
  if (fs.existsSync(file)) {
    const hit = JSON.parse(fs.readFileSync(file, "utf8")) as { value: T; ms: number };
    return { value: hit.value, ms: hit.ms, cached: true };
  }
  const { value, ms } = await fn();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ kind, key, ms, at: new Date().toISOString(), value }, null, 1));
  return { value, ms, cached: false };
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
