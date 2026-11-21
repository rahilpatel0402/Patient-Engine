// Throwaway: push gemini-3.1-flash-tts-preview for slurred speech. Many takes, a few wordings.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { GoogleGenAI } from "@google/genai";
import { requireApiKey } from "../server/env.ts";
import { probe } from "../server/engine/probes.ts";
import { transcribe } from "../server/lib/gemini.ts";

const ai = new GoogleGenAI({ apiKey: requireApiKey(), apiVersion: "v1beta" });
const OUT = path.resolve("smoke/out");
const MODEL = process.argv[2] ?? "gemini-3.1-flash-tts-preview";
const LINE = "Hey there. Everything is fine with me, just calling to get my regular refill sent over to the usual place. No need to change anything. Thanks.";
const PROMPTS: Record<string, string> = {
  drunk: `Say this in a very drunk voice with heavily slurred speech, mushy consonants, and words sliding together: ${LINE}`,
  wasted: `You are extremely intoxicated and can barely form words. Slur everything badly. Drag and smear every consonant, run the words into each other, mumble. Say: ${LINE}`,
  sedated: `Say this like someone heavily sedated coming out of anesthesia: thick tongue, very slurred, mumbling, slow, barely moving the lips: ${LINE}`,
  numb: `Say this with a completely numb mouth and tongue, as after a dental injection, so every word comes out badly slurred and mushy: ${LINE}`,
};
const VOICES = ["Orus", "Charon", "Kore"];

const jobs = Object.entries(PROMPTS).flatMap(([name, text]) =>
  VOICES.map(async (voice) => {
    const label = `${name}-${voice}`;
    try {
      const r = (await ai.interactions.create({
        model: MODEL,
        input: text,
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
      } as never)) as { output_audio?: { data?: string; mime_type?: string } };
      if (!r.output_audio?.data) throw new Error("no audio");
      const raw = path.join(OUT, `slur4-${label}.raw`);
      const clip = path.join(OUT, `slur4-${label}.wav`);
      fs.writeFileSync(raw, Buffer.from(r.output_audio.data, "base64"));
      const pcm = /l16|pcm/i.test(r.output_audio.mime_type ?? "");
      execFileSync(ffmpegStatic as unknown as string, [
        "-y", "-loglevel", "error", ...(pcm ? ["-f", "s16le", "-ar", "24000", "-ac", "1"] : []), "-i", raw, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", clip,
      ]);
      fs.rmSync(raw, { force: true });
      const [p, t] = await Promise.all([probe({ file: clip }), transcribe({ file: clip })]);
      return { label, clip, p: p.probes, t: t.value.trim() };
    } catch (e) {
      return { label, error: (e as Error).message.replace(/\s+/g, " ").slice(0, 140) };
    }
  }),
);

const rows = await Promise.all(jobs);
rows.sort((a, b) => ("p" in b ? b.p!.slurred : -1) - ("p" in a ? a.p!.slurred : -1));
for (const r of rows) {
  if ("error" in r) console.log(`${r.label.padEnd(18)} FAILED ${r.error}`);
  else {
    console.log(`${r.label.padEnd(18)} slurred ${r.p!.slurred.toFixed(2)}  well ${r.p!.sounds_well.toFixed(2)}  breath ${r.p!.short_of_breath.toFixed(2)}  distress ${r.p!.distressed.toFixed(2)}  pain ${r.p!.in_pain.toFixed(2)}  cough ${r.p!.coughing.toFixed(2)}`);
    console.log(`   transcript: ${r.t}`);
  }
}
process.exit(0);
