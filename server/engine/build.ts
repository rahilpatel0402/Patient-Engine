// Builds a patient set: author, voice, normalize, probe, gate.
import * as fs from "node:fs";
import * as path from "node:path";
import { normalize, wavSeconds } from "../lib/audio.ts";
import { ROOT, readJson, writeJson } from "../lib/cache.ts";
import { speak } from "../lib/gemini.ts";
import { writePatient, type Slot } from "./author.ts";
import { gate, probe } from "./probes.ts";
import type { HiddenSign, Patient, PatientScript, Probes } from "./types.ts";

export const setDir = (set: string) => path.join(ROOT, "data", set);
export const patientsFile = (set: string) => path.join(setDir(set), "patients.json");
export const abs = (rel: string) => path.join(ROOT, rel);

async function render(script: PatientScript, set: string, id: string, attempt: number): Promise<string> {
  const audio = await speak({ text: script.spoken_text, style: script.tts_style, voice: script.voice, attempt });
  const raw = path.join(setDir(set), "clips", `${id}.raw.wav`);
  const clip = path.join(setDir(set), "clips", `${id}.wav`);
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.writeFileSync(raw, Buffer.from(audio.value, "base64"));
  await normalize(raw, clip);
  fs.rmSync(raw, { force: true });
  return clip;
}

async function buildOne(model: string, slot: Slot): Promise<Patient> {
  const id = `${slot.set}-${String(slot.index + 1).padStart(2, "0")}-${slot.sign}`;
  const script = await writePatient(model, slot);

  // Render, probe, gate. One fresh take if the gate rejects the first.
  let clip = "";
  let probes = {} as Probes;
  let verdict = { kept: false, reason: "not run" };
  let attempts = 0;
  for (const attempt of [1, 2]) {
    attempts = attempt;
    clip = await render(script, slot.set, id, attempt);
    probes = (await probe({ file: clip })).probes;
    verdict = gate(slot.sign, probes);
    if (verdict.kept) break;
  }

  return {
    ...script,
    id,
    set: slot.set,
    author_model: model,
    clip: path.relative(ROOT, clip).replaceAll("\\", "/"),
    seconds: wavSeconds(clip),
    probes,
    gate: { ...verdict, attempts },
  };
}

export async function buildSet(opts: { set: string; model: string; signs: HiddenSign[] }): Promise<Patient[]> {
  const slots: Slot[] = opts.signs.map((sign, index) => ({ index, sign, set: opts.set }));
  const settled = await Promise.allSettled(slots.map((slot) => buildOne(opts.model, slot)));
  const patients: Patient[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") patients.push(r.value);
    else console.error(`[build] slot ${i + 1} (${slots[i].sign}) failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  });
  writeJson(patientsFile(opts.set), patients);
  return patients;
}

export function loadSet(set: string): Patient[] {
  return fs.existsSync(patientsFile(set)) ? readJson<Patient[]>(patientsFile(set)) : [];
}
