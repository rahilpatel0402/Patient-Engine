// The stress ladder. Degrades the same clips step by step and finds where the
// listening breaks, in two passes to keep the call count down.
//
//   Pass one: probes only, on every clip at every rung. One call per clip per rung.
//   Pass two: transcript, all three arms and the grader, at the hardest rung where
//             the probes still hold, and at the first rung where they do not.
//
// The clips are never re-rendered. Phone quality and room noise are applied to
// the existing audio. The room noise is a recording made at the venue.
//
//   npx tsx scripts/run-ladder.ts exam            runs quietly and saves the result
//   npx tsx scripts/run-ladder.ts dev --show      also prints the summary
import * as fs from "node:fs";
import * as path from "node:path";
import { abs, loadSet, setDir } from "../server/engine/build.ts";
import { probe } from "../server/engine/probes.ts";
import { ARM_LABEL, type CaseResult, type Patient, type Probes } from "../server/engine/types.ts";
import { mixAtSnr, phoneQuality } from "../server/lib/audio.ts";
import { ROOT, readJson, writeJson } from "../server/lib/cache.ts";
import { runCase } from "../server/station1/listening.ts";
import { noiseSource } from "../server/station1/live.ts";
import { ARMS, HEARD_AT, HOLD_SHARE, chooseRungs, ladderRows, type Ladder, type LadderRung } from "../server/station1/report.ts";

const args = process.argv.slice(2);
const set = args.find((a) => !a.startsWith("--")) ?? "exam";
const show = args.includes("--show");

export const RUNGS: LadderRung[] = [
  { id: "clean", label: "Clean", kind: "clean", snr: null },
  { id: "phone", label: "Phone quality", kind: "phone", snr: null },
  { id: "snr10", label: "Room noise, voice 10 dB above it", kind: "noise", snr: 10 },
  { id: "snr5", label: "Room noise, voice 5 dB above it", kind: "noise", snr: 5 },
  { id: "snr0", label: "Room noise as loud as the voice", kind: "noise", snr: 0 },
  { id: "snr-5", label: "Room noise 5 dB above the voice", kind: "noise", snr: -5 },
  { id: "snr-10", label: "Room noise 10 dB above the voice", kind: "noise", snr: -10 },
  { id: "snr-15", label: "Room noise 15 dB above the voice", kind: "noise", snr: -15 },
];

const patients = loadSet(set);
if (!patients.length) throw new Error(`No patients in set "${set}".`);
const noise = noiseSource();
if (!noise) throw new Error("No room noise recording yet. Upload one on the Live mic tab first.");

// Degraded audio can contain real voices from the room, so it lives in a folder git ignores.
const degraded = (rung: LadderRung, p: Patient) => path.join(ROOT, "data", "mixed", "ladder", set, rung.id, `${p.id}.wav`);

async function makeClip(rung: LadderRung, p: Patient): Promise<string> {
  const out = degraded(rung, p);
  if (rung.kind === "phone") await phoneQuality(abs(p.clip), out);
  else mixAtSnr(abs(p.clip), noise!.file, rung.snr!, out);
  return out;
}

// ---- pass one: probes on every clip at every rung ----------------------------------

const probes: Ladder["probes"] = {};
let probeCalls = 0;
let failed = 0;
const steps = RUNGS.filter((r) => r.kind !== "clean");
await Promise.all(
  steps.flatMap((rung) => {
    probes[rung.id] = {};
    return patients.map(async (p) => {
      try {
        const clip = await makeClip(rung, p);
        probes[rung.id][p.id] = (await probe({ file: clip })).probes;
        probeCalls++;
      } catch (e) {
        failed++;
        console.error(`[ladder] ${rung.id} ${p.id} failed: ${e instanceof Error ? e.message : e}`);
      }
    });
  }),
);

// ---- the rule picks the rungs, then pass two runs the arms there --------------------

const { hold, brk } = chooseRungs(patients, RUNGS, probes);
const armRungs = [hold, brk].filter((id): id is string => Boolean(id) && id !== "clean");
const arms: Ladder["arms"] = {};
for (const id of armRungs) {
  const rung = RUNGS.find((r) => r.id === id)!;
  const settled = await Promise.allSettled(
    patients.map((p) => runCase(p, { rung: rung.id, clip: degraded(rung, p), probes: probes[rung.id][p.id] as Probes })),
  );
  arms[id] = settled.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    failed++;
    console.error(`[ladder] arms at ${id} for ${patients[i].id} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    return [];
  });
}

const ladder: Ladder = {
  set,
  noise: { seconds: noise.seconds, level_db: noise.level_db, uploaded: noise.uploaded },
  rungs: RUNGS,
  probes,
  hold_rung: hold,
  break_rung: brk,
  arms,
};
writeJson(path.join(setDir(set), "ladder.json"), ladder);

console.log(`Ladder on "${set}": ${patients.length} clips, ${steps.length} degraded rungs, ${probeCalls} probe results, arms run at ${armRungs.length} rungs, ${failed} failures.`);
console.log(`Rule: a rung holds while at least ${HOLD_SHARE * 100} in 100 sign clips keep their own probe at ${HEARD_AT.toFixed(2)} or higher.`);

if (show) {
  const stationFile = path.join(setDir(set), "station1.json");
  const clean = fs.existsSync(stationFile) ? readJson<CaseResult[]>(stationFile) : [];
  console.log("");
  console.log(["rung".padEnd(36), "heard".padEnd(9), "at 0.80+".padEnd(9), "mean".padEnd(6), "controls fired".padEnd(15), ...ARMS.map((a) => `${a} caught`.padEnd(10)), "role"].join(" "));
  for (const row of ladderRows(patients, ladder, clean)) {
    console.log(
      [
        row.rung.label.padEnd(36),
        `${row.heard} of ${row.clips}`.padEnd(9),
        `${row.strong} of ${row.clips}`.padEnd(9),
        row.mean.toFixed(2).padEnd(6),
        `${row.control_alarms} of ${row.controls}`.padEnd(15),
        ...ARMS.map((a) => (row.arms ? `${row.arms.signs[a].caught} of ${row.arms.signs[a].of}` : "").padEnd(10)),
        row.role === "hold" ? "HOLDS (hardest)" : row.role === "break" ? "BREAKS" : "",
      ].join(" "),
    );
  }
  for (const id of armRungs) {
    console.log(`\nArms at "${RUNGS.find((r) => r.id === id)!.label}":`);
    for (const c of arms[id]) {
      if (!c.patient.gate.kept) continue;
      console.log(`  ${c.patient.id.padEnd(22)} ${c.arms.map((a) => `${a.arm} ${a.grade.status}`).join(" | ")}   transcript: ${c.transcript.slice(0, 90)}`);
    }
  }
  void ARM_LABEL;
}
