import * as fs from "node:fs";
import * as path from "node:path";
import express from "express";
import { loadSet, setPhysicianVerdict } from "./engine/build.ts";
import type { CaseResult } from "./engine/types.ts";
import { PORT, hasApiKey } from "./env.ts";
import { ROOT, readJson } from "./lib/cache.ts";
import { withKeyRole } from "./lib/gemini.ts";
import { noiseSource, probeWithNoise, runLive, saveRoomNoise } from "./station1/live.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));
const audioBody = express.raw({ type: ["audio/*", "video/*", "application/octet-stream"], limit: "40mb" });

const DATA = path.join(ROOT, "data");
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
  res.json({ ok: true, hasKey: hasApiKey(), noise: noiseSource()?.label ?? null });
});

/** Every patient set on disk, with its Station 1 results if they exist. */
app.get("/api/sets", (_req, res) => {
  const sets = fs.existsSync(DATA)
    ? fs.readdirSync(DATA).filter((d) => fs.existsSync(path.join(DATA, d, "patients.json")))
    : [];
  res.json(
    sets.map((set) => {
      const file = path.join(DATA, set, "station1.json");
      const ladderFile = path.join(DATA, set, "ladder.json");
      return {
        set,
        patients: loadSet(set),
        cases: fs.existsSync(file) ? readJson<CaseResult[]>(file) : [],
        ladder: fs.existsSync(ladderFile) ? readJson<unknown>(ladderFile) : null,
      };
    }),
  );
});

/** Live mode: mic or uploaded recording in, observations and probes out. */
app.post("/api/live", audioBody, async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new Error("No audio received");
    const body = req.body;
    res.json(await withKeyRole("live", () => runLive(body, extFor(req.headers["content-type"]))));
  } catch (e) {
    fail(res, e);
  }
});

/** Mix room noise under a clip and probe it again. */
app.post("/api/noise/probe", async (req, res) => {
  try {
    const { clip, level } = req.body as { clip: string; level: number };
    res.json(await withKeyRole("live", () => probeWithNoise(clip, level)));
  } catch (e) {
    fail(res, e);
  }
});

/** A physician listened to a clip and says whether the sign is really there. */
app.post("/api/physician-gate", (req, res) => {
  try {
    const { set, id, valid, note } = req.body as { set: string; id: string; valid: boolean; note?: string };
    res.json(setPhysicianVerdict(set, id, Boolean(valid), String(note ?? "")));
  } catch (e) {
    fail(res, e);
  }
});

/** Upload the room noise recording. */
app.post("/api/noise", audioBody, async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new Error("No audio received");
    const seconds = await saveRoomNoise(req.body, extFor(req.headers["content-type"]));
    res.json({ ok: true, seconds, label: noiseSource()?.label });
  } catch (e) {
    fail(res, e);
  }
});

app.listen(PORT, () => {
  console.log(`Patient Engine server on http://localhost:${PORT}`);
});
