import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";
import { loadSet, setPhysicianVerdict } from "./engine/build.ts";
import type { CaseResult } from "./engine/types.ts";
import { PORT, hasApiKey } from "./env.ts";
import { HOSTED, LIVE_DAILY_LIMIT, RETAIN_MINUTES, liveEnabled, liveLeft, localOnly, needsCode, purgeVisitorAudio, spend, startRetention } from "./hosted.ts";
import { ROOT, readJson } from "./lib/cache.ts";
import { withKeyRole } from "./lib/gemini.ts";
import { agreement, blindClipPath, blindDone, blindLabels, blindPlan, saveBlindLabels } from "./station1/blind.ts";
import { ensureNoise, noiseSource, probeWithNoise, runLive, saveRoomNoise } from "./station1/live.ts";

// Sets whose results stay hidden until the physician has finished the blind labels.
const BLIND_FIRST = ["exam"];
const locked = (set: string) => BLIND_FIRST.includes(set) && !blindDone(set);

const app = express();
app.use(express.json({ limit: "1mb" }));
const audioBody = express.raw({ type: ["audio/*", "video/*", "application/octet-stream"], limit: "40mb" });

const DATA = path.join(ROOT, "data");
// A locked set's clips are served only through the blind route, under neutral names.
app.use("/data", (req, res, next) => {
  const set = req.path.split("/")[1];
  if (set && locked(set)) return void res.status(403).json({ error: "Finish the blind labels first." });
  next();
});
app.use("/data", express.static(DATA, { maxAge: 0 }));

const fail = (res: express.Response, e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  res.status(500).json({ error: message });
};

function extFor(contentType: string | undefined): string {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("webm")) return "webm";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("wav")) return "wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "m4a";
  return "bin";
}

app.get("/api/health", (_req, res) => {
  const noise = noiseSource();
  res.json({
    ok: true,
    hasKey: hasApiKey(),
    noise: noise ? { label: noise.label, synthetic: noise.synthetic, seconds: noise.seconds, uploaded: noise.uploaded, saved: noise.saved } : null,
    // On a public server: whether live calls are on, need a code, and how many are left today.
    hosted: HOSTED,
    live: liveEnabled(),
    needsCode: needsCode(),
    liveLeft: liveLeft(),
    liveLimit: HOSTED ? LIVE_DAILY_LIMIT : null,
    retainMinutes: HOSTED ? RETAIN_MINUTES : null,
  });
});

/** Every patient set on disk, with its Station 1 results if they exist. */
app.get("/api/sets", (_req, res) => {
  const sets = fs.existsSync(DATA)
    ? fs.readdirSync(DATA).filter((d) => fs.existsSync(path.join(DATA, d, "patients.json")))
    : [];
  res.json(
    sets.filter((set) => !locked(set)).map((set) => {
      const file = path.join(DATA, set, "station1.json");
      const ladderFile = path.join(DATA, set, "ladder.json");
      return {
        set,
        patients: loadSet(set),
        cases: fs.existsSync(file) ? readJson<CaseResult[]>(file) : [],
        ladder: fs.existsSync(ladderFile) ? readJson<unknown>(ladderFile) : null,
        comparison: fs.existsSync(path.join(DATA, set, "comparison.json")) ? readJson<unknown>(path.join(DATA, set, "comparison.json")) : null,
        agreement: blindLabels(set).length ? agreement(set) : null,
      };
    }),
  );
});

/** Blind labels: the clips to label, under neutral names, with nothing that gives the sign away. */
app.get("/api/blind/:set", (req, res) => {
  const set = req.params.set;
  const done = blindDone(set);
  res.json({ set, done, clips: blindPlan(set).map((i) => i.key), labels: done ? blindLabels(set) : [] });
});

app.get("/api/blind/:set/audio/:key", (req, res) => {
  const file = blindClipPath(req.params.set, req.params.key);
  if (!file) return void res.status(404).end();
  res.sendFile(file);
});

app.post("/api/blind/:set", localOnly, (req, res) => {
  try {
    res.json(saveBlindLabels(String(req.params.set), (req.body as { labels: Record<string, never> }).labels));
  } catch (e) {
    fail(res, e);
  }
});

/** Live mode: mic or uploaded recording in, observations and probes out. */
app.post("/api/live", spend("live"), audioBody, async (req, res) => {
  try {
    purgeVisitorAudio();
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new Error("No audio received");
    const body = req.body;
    res.json(await withKeyRole("live", () => runLive(body, extFor(req.headers["content-type"]))));
  } catch (e) {
    fail(res, e);
  }
});

/** Mix room noise under a clip and probe it again. */
app.post("/api/noise/probe", spend("probe"), async (req, res) => {
  try {
    const { clip, snr } = req.body as { clip: string; snr: number | null };
    res.json(await withKeyRole("live", () => probeWithNoise(clip, snr ?? null)));
  } catch (e) {
    fail(res, e);
  }
});

/** A physician listened to a clip and says whether the sign is really there. */
app.post("/api/physician-gate", localOnly, (req, res) => {
  try {
    const { set, id, valid, note } = req.body as { set: string; id: string; valid: boolean; note?: string };
    res.json(setPhysicianVerdict(set, id, Boolean(valid), String(note ?? "")));
  } catch (e) {
    fail(res, e);
  }
});

/** Upload the room noise recording. */
app.post("/api/noise", localOnly, audioBody, async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new Error("No audio received");
    const noise = await saveRoomNoise(req.body, extFor(req.headers["content-type"]));
    res.json({ ok: true, seconds: noise.seconds, label: noise.label, saved: noise.saved });
  } catch (e) {
    fail(res, e);
  }
});

// The built page, when there is one. In development Vite serves the page instead.
const CLIENT = path.join(ROOT, "dist", "client");
if (fs.existsSync(path.join(CLIENT, "index.html"))) app.use(express.static(CLIENT));

if (HOSTED) {
  startRetention();
  ensureNoise().catch((e) => console.error(`Could not make the background noise: ${e instanceof Error ? e.message : e}`));
}

app.listen(PORT, () => {
  console.log(`Patient Engine server on http://localhost:${PORT}${HOSTED ? " (public server mode)" : ""}`);
});
