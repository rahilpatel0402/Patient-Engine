// Slurred speech lab. Gemini TTS does not reliably produce slurred speech, so no
// clip passes the perception gate. This script keeps the closest takes as a
// separate set and runs the three arms on them anyway, so a physician can listen
// and so the result on ungated clips is visible.
//   npx tsx scripts/slurred-lab.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { gate, probe } from "../server/engine/probes.ts";
import { patientsFile, setDir } from "../server/engine/build.ts";
import type { CaseResult, Patient } from "../server/engine/types.ts";
import { wavSeconds } from "../server/lib/audio.ts";
import { ROOT, writeJson } from "../server/lib/cache.ts";
import { runCase } from "../server/station1/listening.ts";

const SET = "slurred-lab";
const LINE = "Hey there. Everything is fine with me, just calling to get my regular refill sent over to the usual place. No need to change anything. Thanks.";
const SOURCES = [
  { file: "smoke/out/slur4-drunk-Charon.wav", voice: "Charon", direction: "very drunk, heavily slurred, mushy consonants, words sliding together" },
  { file: "smoke/out/slur4-wasted-Kore.wav", voice: "Kore", direction: "extremely intoxicated, barely forming words, smearing every consonant" },
  { file: "smoke/out/slur4-wasted-Orus.wav", voice: "Orus", direction: "extremely intoxicated, barely forming words, smearing every consonant" },
  { file: "smoke/out/slur4-drunk-Orus.wav", voice: "Orus", direction: "very drunk, heavily slurred, mushy consonants, words sliding together" },
];

const patients: Patient[] = [];
for (const [i, s] of SOURCES.entries()) {
  if (!fs.existsSync(s.file)) continue;
  const id = `${SET}-${String(i + 1).padStart(2, "0")}-slurred`;
  const clip = path.join(setDir(SET), "clips", `${id}.wav`);
  fs.mkdirSync(path.dirname(clip), { recursive: true });
  fs.copyFileSync(s.file, clip);
  const probes = (await probe({ file: clip })).probes;
  patients.push({
    id,
    set: SET,
    author_model: "gemini-3.1-flash-tts-preview, delivery instruction in the prompt",
    persona: "A synthetic voice asked to deny any problem while speaking with slurred speech.",
    spoken_text: LINE,
    tts_style: s.direction,
    voice: s.voice,
    hidden_sign: "slurred",
    expected_urgency: "urgent",
    clip: path.relative(ROOT, clip).replaceAll("\\", "/"),
    seconds: wavSeconds(clip),
    probes,
    gate: { ...gate("slurred", probes), attempts: 1 },
  });
}
writeJson(patientsFile(SET), patients);

const cases: CaseResult[] = await Promise.all(patients.map((p) => runCase(p)));
writeJson(path.join(setDir(SET), "station1.json"), cases);

for (const c of cases) {
  console.log(`\n${c.patient.id}  slurred probe ${c.patient.probes.slurred.toFixed(2)}  gate: ${c.patient.gate.kept ? "kept" : "dropped"}`);
  for (const a of c.arms) {
    console.log(`  ${a.arm}: ${a.grade.caught ? "caught" : "MISSED"} (grader ${a.grade.identifies_sign?.toFixed(2)}), urgency ${a.note.urgency}`);
    console.log(`     ${a.note.observations.join(" | ")}`);
  }
}
