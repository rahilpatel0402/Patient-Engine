// Guards for running the full app on a public server.
//
// On a laptop none of this applies. With HOSTED=1 the server:
//   - asks for an access code before any call that spends API credit
//   - caps how many live recordings and noise probes it will run in a day
//   - refuses anything that would change the saved results
//   - deletes visitors' recordings after a short time
import { timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { ROOT } from "./lib/cache.ts";

export const HOSTED = process.env.HOSTED === "1";
const ACCESS_CODE = process.env.ACCESS_CODE?.trim() ?? "";
export const LIVE_DAILY_LIMIT = Number(process.env.LIVE_DAILY_LIMIT ?? 40);
const PROBE_DAILY_LIMIT = LIVE_DAILY_LIMIT * 15;
export const RETAIN_MINUTES = Number(process.env.RETAIN_MINUTES ?? 30);

/** Live calls are open on a laptop. On a public server they need a code, and are off if none is set. */
export const liveEnabled = () => !HOSTED || ACCESS_CODE.length > 0;
export const needsCode = () => HOSTED && ACCESS_CODE.length > 0;

function codeMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(ACCESS_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

const usage = { day: "", live: 0, probe: 0 };
function today(): typeof usage {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, live: 0, probe: 0 });
  return usage;
}

export const liveLeft = () => (HOSTED ? Math.max(0, LIVE_DAILY_LIMIT - today().live) : null);

/** Express guard for the calls that spend API credit. */
export function spend(kind: "live" | "probe") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!HOSTED) return next();
    if (!liveEnabled()) return void res.status(403).json({ error: "Live mode is switched off on this server." });
    if (!codeMatches(String(req.headers["x-access-code"] ?? ""))) {
      return void res.status(401).json({ error: "That access code is not right. Enter the code you were given on the Live mic tab." });
    }
    const u = today();
    const limit = kind === "live" ? LIVE_DAILY_LIMIT : PROBE_DAILY_LIMIT;
    if (u[kind] >= limit) return void res.status(429).json({ error: "Today's limit for this demo has been reached. Please try again tomorrow." });
    u[kind]++;
    next();
  };
}

/** Express guard for anything that would change the saved results. */
export function localOnly(_req: Request, res: Response, next: NextFunction) {
  if (HOSTED) return void res.status(403).json({ error: "This copy is read-only. The saved results cannot be changed here." });
  next();
}

// ---- retention -----------------------------------------------------------------

const VISITOR_DIRS = [path.join(ROOT, "data", "live"), path.join(ROOT, "data", "mixed"), path.join(os.tmpdir(), "patient-engine-flac")];

/** Deletes visitors' recordings, and the copies made from them, once they are older than the limit. */
export function purgeVisitorAudio(): number {
  if (!HOSTED) return 0;
  const cutoff = Date.now() - RETAIN_MINUTES * 60_000;
  let removed = 0;
  for (const dir of VISITOR_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.rmSync(file, { force: true });
          removed++;
        }
      } catch {
        // Another request may have removed it first.
      }
    }
  }
  return removed;
}

export function startRetention(): void {
  if (!HOSTED) return;
  purgeVisitorAudio();
  setInterval(purgeVisitorAudio, 5 * 60_000).unref();
}
