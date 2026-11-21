// Throwaway: rerun the live mode arms on the most recent live recording, without
// creating a new recording. Used to check the wording of the observations.
//   npx tsx smoke/live-check.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { probe } from "../server/engine/probes.ts";
import { PROBE_KEYS, PROBE_LABEL, type ArmKey } from "../server/engine/types.ts";
import { wavSeconds } from "../server/lib/audio.ts";
import { transcribe } from "../server/lib/gemini.ts";
import { observe } from "../server/station1/live.ts";

const dir = path.resolve("data/live");
const clips = fs
  .readdirSync(dir)
  .filter((f) => /^live-\d+\.wav$/.test(f))
  .sort()
  .reverse()
  .slice(0, Number(process.argv[2] ?? 1));

for (const name of clips) {
  const clip = path.join(dir, name);
  const [heard, said] = await Promise.all([probe({ file: clip }), transcribe({ file: clip })]);
  console.log(`\n${name}  ${wavSeconds(clip)} s`);
  console.log(`  transcript: ${said.value.trim()}`);
  console.log(`  probes: ${PROBE_KEYS.map((k) => `${PROBE_LABEL[k]} ${heard.probes[k].toFixed(2)}`).join(" | ")}`);
  for (const arm of ["A", "B", "C"] as ArmKey[]) {
    const out = await observe(arm, said.value.trim(), clip, heard.probes);
    console.log(`  ${arm}:`);
    for (const o of out.observations) console.log(`     - ${o}`);
  }
}
