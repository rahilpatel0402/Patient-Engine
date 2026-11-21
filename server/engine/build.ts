// Builds a patient set: author, voice, normalize, probe, gate.
import * as fs from "node:fs";
import * as path from "node:path";
import { normalize, wavSeconds } from "../lib/audio.ts";
import { ROOT, readJson, writeJson } from "../lib/cache.ts";
import { speak, speakPrompted } from "../lib/gemini.ts";
import { writePatient, type Slot } from "./author.ts";
import { gate, probe } from "./probes.ts";
import { PHYSICIAN_GATED, type GateResult, type Patient, type PatientScript, type Probes, type HiddenSign } from "./types.ts";

export const setDir = (set: string) => path.join(ROOT, "data", set);
export const patientsFile = (set: string) => path.join(setDir(set), "patients.json");
export const abs = (rel: string) => path.join(ROOT, rel);

// The main TTS model does not slur. An older Gemini voice model does, when the
// delivery instruction is written into the prompt.
export const SLUR_MODEL = "gemini-3.1-flash-tts-preview";
const SLUR_INSTRUCTION = "Say this in a very drunk voice with heavily slurred speech, mushy consonants, and words sliding together";
const SLUR_TAKES = 3;

const stripTags = (text: string) => text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function render(script: PatientScript, set: string, name: string, attempt: number): Promise<string> {
  const raw = path.join(setDir(set), "clips", `${name}.raw`);
  const clip = path.join(setDir(set), "clips", `${name}.wav`);
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  if (script.hidden_sign === "slurred") {
    const audio = await speakPrompted({ model: SLUR_MODEL, prompt: `${SLUR_INSTRUCTION}: ${stripTags(script.spoken_text)}`, voice: script.voice, attempt });
    fs.writeFileSync(raw, Buffer.from(audio.value.data, "base64"));
    await normalize(raw, clip, { rawPcm: /l16|pcm/i.test(audio.value.mime) });
  } else {
    const audio = await speak({ text: script.spoken_text, style: script.tts_style, voice: script.voice, attempt });
    fs.writeFileSync(raw, Buffer.from(audio.value, "base64"));
    await normalize(raw, clip);
  }
  fs.rmSync(raw, { force: true });
  return clip;
}

async function buildOne(model: string, slot: Slot): Promise<Patient> {
  const id = `${slot.set}-${String(slot.index + 1).padStart(2, "0")}-${slot.sign}`;
  const script = await writePatient(model, slot);
  const final = path.join(setDir(slot.set), "clips", `${id}.wav`);

  let probes = {} as Probes;
  let verdict: GateResult;

  if (PHYSICIAN_GATED.includes(slot.sign)) {
    // Render a few takes and keep the one the listening model rates highest.
    // The probe only picks the take. A physician decides whether it is valid.
    const signProbe = "slurred";
    let best: { clip: string; probes: Probes } | null = null;
    for (let take = 1; take <= SLUR_TAKES; take++) {
      const clip = await render(script, slot.set, `${id}.take${take}`, take);
      const p = (await probe({ file: clip })).probes;
      if (!best || p[signProbe] > best.probes[signProbe]) best = { clip, probes: p };
    }
    fs.copyFileSync(best!.clip, final);
    for (let take = 1; take <= SLUR_TAKES; take++) fs.rmSync(path.join(setDir(slot.set), "clips", `${id}.take${take}.wav`), { force: true });
    probes = best!.probes;
    verdict = { kept: false, by: "physician", attempts: SLUR_TAKES, reason: `waiting for a physician to listen (${signProbe} probe ${probes[signProbe].toFixed(2)})` };
  } else {
    // Render, probe, gate. One fresh take if the gate rejects the first.
    let attempts = 0;
    let result = { kept: false, reason: "not run" };
    for (const attempt of [1, 2]) {
      attempts = attempt;
      const clip = await render(script, slot.set, id, attempt);
      probes = (await probe({ file: clip })).probes;
      result = gate(slot.sign, probes);
      if (result.kept) break;
    }
    verdict = { ...result, attempts, by: "probe" };
  }

  return {
    ...script,
    id,
    set: slot.set,
    author_model: script.hidden_sign === "slurred" ? `${model}, voiced by ${SLUR_MODEL}` : model,
    clip: path.relative(ROOT, final).replaceAll("\\", "/"),
    seconds: wavSeconds(final),
    probes,
    gate: verdict,
  };
}

export async function buildSet(opts: { set: string; model: string; signs: HiddenSign[] }): Promise<Patient[]> {
  const slots: Slot[] = opts.signs.map((sign, index) => ({ index, sign, set: opts.set }));
  const previous = new Map(loadSet(opts.set).map((p) => [p.id, p]));
  const settled = await Promise.allSettled(slots.map((slot) => buildOne(opts.model, slot)));
  const patients: Patient[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      // A rebuild must not erase a physician's verdict on the same clip.
      const old = previous.get(r.value.id);
      patients.push(old?.gate.physician && old.probes.slurred === r.value.probes.slurred ? { ...r.value, gate: old.gate } : r.value);
    } else console.error(`[build] slot ${i + 1} (${slots[i].sign}) failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  });
  writeJson(patientsFile(opts.set), patients);
  return patients;
}

export function loadSet(set: string): Patient[] {
  return fs.existsSync(patientsFile(set)) ? readJson<Patient[]>(patientsFile(set)) : [];
}

/** Records a physician's decision on a clip the probe is not trusted to judge. */
export function setPhysicianVerdict(set: string, id: string, valid: boolean, note: string): Patient {
  const patients = loadSet(set);
  const patient = patients.find((p) => p.id === id);
  if (!patient) throw new Error(`No patient ${id} in set ${set}`);
  if (!PHYSICIAN_GATED.includes(patient.hidden_sign)) throw new Error(`${patient.hidden_sign} is gated by the probe, not by a physician`);
  const heard = patient.probes.slurred.toFixed(2);
  patient.gate = {
    ...patient.gate,
    kept: valid,
    by: "physician",
    physician: { valid, note, at: new Date().toISOString() },
    reason: valid ? `a physician listened and heard slurred speech (probe ${heard})` : `a physician listened and did not hear slurred speech (probe ${heard})`,
  };
  writeJson(patientsFile(set), patients);
  return patient;
}
