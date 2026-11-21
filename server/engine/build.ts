// Builds a patient set: author, voice, normalize, probe, gate.
import * as fs from "node:fs";
import * as path from "node:path";
import { normalize, wavSeconds } from "../lib/audio.ts";
import { ROOT, readJson, writeJson } from "../lib/cache.ts";
import { speak, speakPrompted } from "../lib/gemini.ts";
import { controlKind, writePatient, type Slot } from "./author.ts";
import { secondListener, slurConsensus } from "./listener.ts";
import { gate, probe } from "./probes.ts";
import { PHYSICIAN_GATED, SIGN_PROBE, type GateResult, type HiddenSign, type Patient, type PatientScript, type Probes, type Sign } from "./types.ts";

export const setDir = (set: string) => path.join(ROOT, "data", set);
export const patientsFile = (set: string) => path.join(setDir(set), "patients.json");
export const abs = (rel: string) => path.join(ROOT, rel);

// The main TTS model does not slur, and its groans come out as heavy breathing.
// An older Gemini voice model does both when the delivery instruction is written
// into the prompt. These two signs are voiced by it. Several takes are rendered
// and the one the listening model rates highest for the sign is kept.
export const PROMPTED_MODEL = "gemini-3.1-flash-tts-preview";
// Wording and take counts come from measuring four takes of each candidate
// wording on the practice scripts. Groaning lands on most takes. Slurring lands
// on few, which is why slurred clips usually end up in front of a physician.
const PROMPTED: Partial<Record<Sign, { instruction: string; takes: number }>> = {
  groaning: {
    instruction:
      "Say this while in agony. Before and between the phrases, let out long loud groans and moans of pain like 'aaagh' and 'ooohh', with a sharp cry of pain in the middle",
    takes: 4,
  },
  slurred: {
    instruction:
      "You are extremely intoxicated and can barely form words. Slur everything badly. Drag and smear every consonant, run the words into each other, mumble. Say",
    takes: 5,
  },
};

const stripTags = (text: string) => text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function render(script: PatientScript, set: string, name: string, attempt: number): Promise<string> {
  const raw = path.join(setDir(set), "clips", `${name}.raw`);
  const clip = path.join(setDir(set), "clips", `${name}.wav`);
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  const instruction = script.hidden_sign === "none" ? undefined : PROMPTED[script.hidden_sign]?.instruction;
  if (instruction) {
    const audio = await speakPrompted({ model: PROMPTED_MODEL, prompt: `${instruction}: ${stripTags(script.spoken_text)}`, voice: script.voice, attempt });
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

/** Two automatic listeners vote on a slurred clip. A physician is needed only when they disagree. */
export async function autoSlurGate(clip: string, probes: Probes): Promise<Omit<GateResult, "attempts">> {
  const heard = await secondListener({ file: clip });
  const auto = slurConsensus(probes.slurred, heard.slurred);
  if (auto.decision === "review") return { kept: false, by: "physician", auto, reason: `waiting for a physician: ${auto.why}` };
  return { kept: auto.decision === "keep", by: "consensus", auto, reason: auto.why };
}

async function buildOne(model: string, slot: Slot): Promise<Patient> {
  const id = `${slot.set}-${String(slot.index + 1).padStart(2, "0")}-${slot.sign}`;
  const script = await writePatient(model, slot);
  const final = path.join(setDir(slot.set), "clips", `${id}.wav`);
  const prompted = slot.sign !== "none" && PROMPTED[slot.sign] !== undefined;

  let probes = {} as Probes;
  let verdict: GateResult;

  if (prompted) {
    // Render several takes and keep the one the listening model rates highest.
    const key = SIGN_PROBE[slot.sign as Sign];
    let best: { clip: string; probes: Probes } | null = null;
    const takes = PROMPTED[slot.sign as Sign]!.takes;
    for (let take = 1; take <= takes; take++) {
      const clip = await render(script, slot.set, `${id}.take${take}`, take);
      const p = (await probe({ file: clip })).probes;
      if (!best || p[key] > best.probes[key]) best = { clip, probes: p };
    }
    fs.copyFileSync(best!.clip, final);
    for (let take = 1; take <= takes; take++) fs.rmSync(path.join(setDir(slot.set), "clips", `${id}.take${take}.wav`), { force: true });
    probes = best!.probes;
    verdict = PHYSICIAN_GATED.includes(slot.sign)
      ? { ...(await autoSlurGate(final, probes)), attempts: takes }
      : { ...gate(slot.sign, probes), attempts: takes, by: "probe" };
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
    author_model: prompted ? `${model}, voiced by ${PROMPTED_MODEL}` : model,
    clip: path.relative(ROOT, final).replaceAll("\\", "/"),
    seconds: wavSeconds(final),
    probes,
    gate: verdict,
  };
}

export async function buildSet(opts: { set: string; model: string; signs: HiddenSign[] }): Promise<Patient[]> {
  let controls = 0;
  const slots: Slot[] = opts.signs.map((sign, index) => ({ index, sign, set: opts.set, control: sign === "none" ? controlKind(controls++) : undefined }));
  const previous = new Map(loadSet(opts.set).map((p) => [p.id, p]));
  const settled = await Promise.allSettled(slots.map((slot) => buildOne(opts.model, slot)));
  const patients: Patient[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      // A rebuild must not erase a physician's verdict on the same clip.
      const old = previous.get(r.value.id);
      const sameClip = old && JSON.stringify(old.probes) === JSON.stringify(r.value.probes);
      patients.push(old?.gate.physician && sameClip ? { ...r.value, gate: old.gate } : r.value);
    } else console.error(`[build] slot ${i + 1} (${slots[i].sign}) failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  });
  writeJson(patientsFile(opts.set), patients);
  return patients;
}

export function loadSet(set: string): Patient[] {
  return fs.existsSync(patientsFile(set)) ? readJson<Patient[]>(patientsFile(set)) : [];
}

/** Records a physician's decision on a clip the automatic listeners could not settle. */
export function setPhysicianVerdict(set: string, id: string, valid: boolean, note: string): Patient {
  const patients = loadSet(set);
  const patient = patients.find((p) => p.id === id);
  if (!patient) throw new Error(`No patient ${id} in set ${set}`);
  if (patient.hidden_sign === "none") throw new Error("Healthy controls are not physician-gated");
  const label = SIGN_PROBE[patient.hidden_sign].replaceAll("_", " ");
  const heard = patient.probes[SIGN_PROBE[patient.hidden_sign]].toFixed(2);
  patient.gate = {
    ...patient.gate,
    kept: valid,
    by: "physician",
    physician: { valid, note, at: new Date().toISOString() },
    reason: valid ? `a physician listened and heard the sign (${label} probe ${heard})` : `a physician listened and did not hear the sign (${label} probe ${heard})`,
  };
  writeJson(patientsFile(set), patients);
  return patient;
}
