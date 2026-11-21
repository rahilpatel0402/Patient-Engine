// Throwaway: slurred speech, round two.
// 1. Other TTS models, in case one of them can slur.
// 2. Wider listening questions, in case the probe wording is too narrow.
// 3. A second listener: what does Hydrogen say it hears?
import * as fs from "node:fs";
import * as path from "node:path";
import { normalize } from "../server/lib/audio.ts";
import { decide, generate, speak, MODELS, type Question } from "../server/lib/gemini.ts";

const OUT = path.resolve("smoke/out");
const TEXT =
  "Hey there. Everything is fine with me, just calling in from the job site <long pause> to get my regular refill sent over to the usual place. <long pause> No need to change anything, just the standard order whenever you have a minute. <long pause> Thanks.";
const STYLES: Record<string, string> = {
  sedated: "Heavily sedated and barely awake. Mumbling, slurred, drawling speech, dragging every syllable, lips barely moving, trailing off.",
  drunk: "Extremely drunk and heavily intoxicated. Slurring every word, tongue thick and heavy, consonants mushy and smeared, words sliding into each other, slow and sloppy.",
};
const TTS_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-pro-preview-tts", "gemini-2.5-flash-preview-tts"];

const QUESTIONS: Record<string, Question> = {
  slurred: { type: "noul", instructions: "Is the speaker's speech slurred?" },
  articulation: { type: "noul", instructions: "Is the speaker's articulation imprecise, mumbled, or mushy, with consonants that are not crisp?" },
  impaired: { type: "noul", instructions: "Does the speaker sound intoxicated, sedated, or drowsy?" },
  slow: { type: "noul", instructions: "Is the speaker talking unusually slowly, dragging out syllables?" },
  normal_speech: { type: "noul", instructions: "Is the speaker's speech clear, crisp, and normally paced?" },
};

async function listen(name: string, clip: string) {
  const [d, h] = await Promise.all([
    decide({ audio: { file: clip }, questions: QUESTIONS }),
    generate({
      model: MODELS.hydrogen,
      text: "Describe how this person's speech sounds: articulation, pace, and clarity. Two sentences. Do not summarize what they say.",
      audio: { file: clip },
      thinking: "low",
    }),
  ]);
  const n = (k: string) => {
    const a = d.value[k];
    return a.type === "noul" ? a.noul.toFixed(2) : "?";
  };
  console.log(`${name.padEnd(40)} slurred ${n("slurred")}  mumbled ${n("articulation")}  impaired ${n("impaired")}  slow ${n("slow")}  normal ${n("normal_speech")}`);
  console.log(`   Hydrogen: ${h.value.trim().replace(/\s+/g, " ")}`);
}

const jobs: Promise<void>[] = [];

// Existing clips: the two dev slurred clips, a healthy control, and round one's best.
for (const [name, clip] of [
  ["dev-09-slurred", "data/dev/clips/dev-09-slurred.wav"],
  ["dev-10-slurred", "data/dev/clips/dev-10-slurred.wav"],
  ["dev-11-none (control)", "data/dev/clips/dev-11-none.wav"],
  ["3.8-flash sedated (round one best)", "smoke/out/slur-sedated-plain-Orus.wav"],
  ["3.8-flash drunk", "smoke/out/slur-drunk-plain-Orus.wav"],
] as const) {
  if (fs.existsSync(clip)) jobs.push(listen(name, clip));
}

for (const model of TTS_MODELS) {
  for (const [s, style] of Object.entries(STYLES)) {
    jobs.push(
      (async () => {
        const name = `${model.replace("gemini-", "")} ${s}`;
        try {
          const audio = await speak({ text: TEXT, style, voice: "Orus", model });
          const raw = path.join(OUT, `slur2-${model}-${s}.raw.wav`);
          const clip = path.join(OUT, `slur2-${model}-${s}.wav`);
          fs.writeFileSync(raw, Buffer.from(audio.value, "base64"));
          await normalize(raw, clip);
          fs.rmSync(raw, { force: true });
          await listen(name, clip);
        } catch (e) {
          console.log(`${name.padEnd(40)} FAILED ${(e as Error).message.replace(/\s+/g, " ").slice(0, 140)}`);
        }
      })(),
    );
  }
}
await Promise.all(jobs);
