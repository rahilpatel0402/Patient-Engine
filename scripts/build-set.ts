// Builds a patient set and prints the gate table.
//   npx tsx scripts/build-set.ts dev                       Argon, 12 patients
//   npx tsx scripts/build-set.ts exam                      Carbon, 24 patients
//   npx tsx scripts/build-set.ts trial --model gemini-4-hydrogen --per-sign 1 --controls 1
import { buildSet } from "../server/engine/build.ts";
import { PROBE_KEYS, SIGNS, type HiddenSign, type Patient } from "../server/engine/types.ts";
import { MODELS } from "../server/lib/gemini.ts";

const args = process.argv.slice(2);
const set = args[0] ?? "dev";
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const model = flag("model") ?? (set === "exam" ? MODELS.carbon : MODELS.argon);
const signList = (flag("signs")?.split(",") as HiddenSign[] | undefined) ?? [...SIGNS];

function plan(): HiddenSign[] {
  if (set === "exam" && !flag("per-sign")) {
    // 16 sign patients and 8 controls. Spread evenly, extras go to the first signs.
    const out: HiddenSign[] = [];
    for (let i = 0; i < 16; i++) out.push(signList[i % signList.length]);
    return [...out.sort((a, b) => signList.indexOf(a as never) - signList.indexOf(b as never)), ...Array<HiddenSign>(8).fill("none")];
  }
  const perSign = Number(flag("per-sign") ?? 2);
  const controls = Number(flag("controls") ?? 2);
  return [...signList.flatMap((s) => Array<HiddenSign>(perSign).fill(s)), ...Array<HiddenSign>(controls).fill("none")];
}

export function printGateTable(patients: Patient[]) {
  const short: Record<string, string> = {
    short_of_breath: "breath", in_pain: "pain", coughing: "cough", distressed: "distr", slurred: "slur", long_pauses: "pause", sounds_well: "well",
  };
  console.log(["patient".padEnd(24), "sign".padEnd(11), ...PROBE_KEYS.map((k) => short[k].padStart(6)), " gate"].join(" "));
  for (const p of patients) {
    console.log(
      [
        p.id.padEnd(24),
        p.hidden_sign.padEnd(11),
        ...PROBE_KEYS.map((k) => p.probes[k].toFixed(2).padStart(6)),
        ` ${p.gate.kept ? "KEPT" : "DROPPED"} (take ${p.gate.attempts}; ${p.gate.reason})`,
      ].join(" "),
    );
  }
  const kept = patients.filter((p) => p.gate.kept).length;
  console.log(`\n${kept} of ${patients.length} kept, ${patients.length - kept} dropped by the gate.`);
}

const signs = plan();
console.log(`Building "${set}" with ${model}: ${signs.length} patients`);
const patients = await buildSet({ set, model, signs });
printGateTable(patients);
for (const p of patients) console.log(`\n${p.id}  [${p.voice}, ${p.seconds}s, style: ${p.tts_style}]\n  ${p.spoken_text}\n  ${p.clip}`);
