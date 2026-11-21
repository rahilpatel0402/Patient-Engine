// Throwaway: how often does the prompted voice model produce the sign, per take?
//   npx tsx smoke/takes.ts groaning|slurred
import * as fs from "node:fs";
import * as path from "node:path";
import { probe } from "../server/engine/probes.ts";
import { loadSet } from "../server/engine/build.ts";
import { normalize } from "../server/lib/audio.ts";
import { speakPrompted } from "../server/lib/gemini.ts";

const sign = (process.argv[2] ?? "groaning") as "groaning" | "slurred";
const OUT = path.resolve("smoke/out");
const INSTRUCTIONS: Record<string, Record<string, string>> = {
  groaning: {
    spasm: "Say this while having a back spasm: sudden sharp cries of pain, gritted teeth, groaning",
    hide: "Say this while having a spasm of pain and trying to hide it: sudden sharp cries of pain, gritted teeth, low groans between phrases",
    loud: "Say this while in agony. Before and between the phrases, let out long loud groans and moans of pain like 'aaagh' and 'ooohh', with a sharp cry of pain in the middle",
  },
  slurred: {
    drunk: "Say this in a very drunk voice with heavily slurred speech, mushy consonants, and words sliding together",
    wasted: "You are extremely intoxicated and can barely form words. Slur everything badly. Drag and smear every consonant, run the words into each other, mumble. Say",
  },
};
const scripts = loadSet("dev").filter((p) => p.hidden_sign === sign).map((p) => ({ text: p.spoken_text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), voice: p.voice }));
const SHORT = "Morning. Everything is fine with me. I just need to book my regular check-up for next month. Nothing pressing at all.";
const cases = [
  ...scripts.map((s, i) => ({ label: `script${i + 1}/${s.voice}`, ...s })),
  { label: "short/Orus", text: SHORT, voice: "Orus" },
  { label: "short/Charon", text: SHORT, voice: "Charon" },
];

const jobs: Promise<string>[] = [];
for (const [name, instruction] of Object.entries(INSTRUCTIONS[sign])) {
  for (const c of cases) {
    jobs.push(
      (async () => {
        const scores: number[] = [];
        for (let take = 1; take <= 4; take++) {
          try {
            const a = await speakPrompted({ model: "gemini-3.1-flash-tts-preview", prompt: `${instruction}: ${c.text}`, voice: c.voice, attempt: 100 + take });
            const raw = path.join(OUT, `takes-${sign}-${name}-${c.label.replace("/", "-")}-${take}.raw`);
            const clip = raw.replace(/\.raw$/, ".wav");
            fs.writeFileSync(raw, Buffer.from(a.value.data, "base64"));
            await normalize(raw, clip, { rawPcm: /l16|pcm/i.test(a.value.mime) });
            fs.rmSync(raw, { force: true });
            scores.push((await probe({ file: clip })).probes[sign]);
          } catch {
            scores.push(-1);
          }
        }
        return `${name.padEnd(7)} ${c.label.padEnd(18)} ${scores.map((s) => (s < 0 ? " ERR" : s.toFixed(2))).join("  ")}   best ${Math.max(...scores).toFixed(2)}`;
      })(),
    );
  }
}
(await Promise.all(jobs)).forEach((l) => console.log(l));
