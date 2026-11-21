// Live mode: a real person speaks into the mic. The output is observations only.
// The schema has a single field, so the model cannot return red flags, urgency,
// or advice for a live human voice.
import * as fs from "node:fs";
import * as path from "node:path";
import { probe } from "../engine/probes.ts";
import { PROBE_KEYS, PROBE_LABEL, type ArmKey, type Probes } from "../engine/types.ts";
import { mixNoise, normalize, wavSeconds } from "../lib/audio.ts";
import { ROOT } from "../lib/cache.ts";
import { MODELS, generateJson, transcribe } from "../lib/gemini.ts";

const LIVE_DIR = path.join(ROOT, "data", "live");
const NOISE_DIR = path.join(ROOT, "data", "noise");
export const ROOM_NOISE = path.join(NOISE_DIR, "room.wav");

const LIVE_SYSTEM = `You are given a short recording or transcript of a person acting out a patient for a software demonstration. Nobody here is a real patient.

List only what you directly observe: what was said, and, if you can hear the voice or are given listening results, how it sounded. Short factual phrases.

If you are given listening results, each number is a probability from 0 to 1 that the sign is present. It is not a time in the recording.
- 0.80 or higher: report the sign as "very likely".
- 0.50 to 0.79: report the sign as "likely".
- Below 0.50: the listening model probably did not hear that sign. Do not list it at all.
Describe each reported sign in plain words and never write the numbers.

Do not interpret. Do not name conditions or causes. Do not rate urgency. Do not give advice, next steps, or recommendations of any kind.`;

const LIVE_SCHEMA = {
  type: "object",
  properties: { observations: { type: "array", items: { type: "string" } } },
  required: ["observations"],
};

export async function observe(arm: ArmKey, transcript: string, clip: string, probes: Probes): Promise<{ observations: string[]; ms: number }> {
  const said = `Transcript of what the person said:\n"${transcript}"`;
  const text =
    arm === "A"
      ? said
      : arm === "B"
        ? "Audio recording attached."
        : `${said}\n\nA listening model heard the recording. Each line is the probability from 0 to 1 that the statement is true of the voice:\n${PROBE_KEYS.map((k) => `- ${PROBE_LABEL[k]}: ${probes[k].toFixed(2)}`).join("\n")}`;
  const out = await generateJson<{ observations: string[] }>({
    model: MODELS.hydrogen,
    system: LIVE_SYSTEM,
    text,
    audio: arm === "B" ? { file: clip } : undefined,
    schema: LIVE_SCHEMA,
    thinking: "low",
  });
  // Keep only the one allowed field, whatever came back.
  return { observations: (out.value.observations ?? []).map(String), ms: out.ms };
}

export type LiveResult = {
  id: string;
  clip: string;
  seconds: number;
  transcript: string;
  probes: Probes;
  probe_ms: number;
  arms: Record<ArmKey, { observations: string[]; ms: number }>;
};

const rel = (file: string) => path.relative(ROOT, file).replaceAll("\\", "/");
const liveClip = (id: string) => path.join(LIVE_DIR, `${id}.wav`);

export async function runLive(upload: Buffer, ext: string): Promise<LiveResult> {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
  const id = `live-${Date.now()}`;
  const raw = path.join(LIVE_DIR, `${id}.upload.${ext}`);
  fs.writeFileSync(raw, upload);
  const clip = await normalize(raw, liveClip(id));
  fs.rmSync(raw, { force: true });

  const [heard, said] = await Promise.all([probe({ file: clip }), transcribe({ file: clip })]);
  const transcript = said.value.trim();
  const [A, B, C] = await Promise.all((["A", "B", "C"] as ArmKey[]).map((arm) => observe(arm, transcript, clip, heard.probes)));
  return { id, clip: rel(clip), seconds: wavSeconds(clip), transcript, probes: heard.probes, probe_ms: heard.ms, arms: { A, B, C } };
}

// ---- noise ---------------------------------------------------------------------

export function noiseSource(): { file: string; label: string } | null {
  return fs.existsSync(ROOM_NOISE) ? { file: ROOM_NOISE, label: "Room noise recorded at the venue" } : null;
}

export async function saveRoomNoise(upload: Buffer, ext: string): Promise<number> {
  fs.mkdirSync(NOISE_DIR, { recursive: true });
  const raw = path.join(NOISE_DIR, `room.upload.${ext}`);
  fs.writeFileSync(raw, upload);
  await normalize(raw, ROOM_NOISE);
  fs.rmSync(raw, { force: true });
  return wavSeconds(ROOM_NOISE);
}

/** Mixes noise under any clip in the repo and probes the result. Level is 0 to 100. */
export async function probeWithNoise(clipRel: string, level: number): Promise<{ clip: string; probes: Probes; probe_ms: number; level: number }> {
  const source = path.resolve(ROOT, clipRel);
  if (!source.startsWith(path.join(ROOT, "data")) || !fs.existsSync(source)) throw new Error("Unknown clip");
  const pct = Math.max(0, Math.min(100, Math.round(level)));
  if (pct === 0) {
    const heard = await probe({ file: source });
    return { clip: rel(source), probes: heard.probes, probe_ms: heard.ms, level: 0 };
  }
  const noise = noiseSource();
  if (!noise) throw new Error("No room noise file yet. Upload one first.");
  // 100 on the slider is the noise at three times its recorded level.
  const gain = (pct / 100) * 3;
  const out = path.join(ROOT, "data", "mixed", `${path.basename(source, ".wav")}.noise${pct}.wav`);
  await mixNoise(source, noise.file, gain, out);
  const heard = await probe({ file: out });
  return { clip: rel(out), probes: heard.probes, probe_ms: heard.ms, level: pct };
}
