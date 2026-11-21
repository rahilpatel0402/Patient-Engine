// Throwaway: older TTS models take the delivery instruction inside the text.
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { requireApiKey } from "../server/env.ts";
import { normalize } from "../server/lib/audio.ts";
import { decide } from "../server/lib/gemini.ts";

const ai = new GoogleGenAI({ apiKey: requireApiKey(), apiVersion: "v1beta" });
const OUT = path.resolve("smoke/out");
const LINE = "Hey there. Everything is fine with me, just calling to get my regular refill sent over to the usual place. No need to change anything. Thanks.";
const PROMPTS: Record<string, string> = {
  drunk: `Say this in a very drunk voice with heavily slurred speech, mushy consonants, and words sliding together: ${LINE}`,
  stroke: `Say this with severe dysarthria, like someone whose mouth is numb after a stroke, thick tongue, imprecise slurred consonants: ${LINE}`,
};

for (const model of ["gemini-2.5-pro-preview-tts", "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"]) {
  for (const [name, text] of Object.entries(PROMPTS)) {
    const label = `${model.replace("gemini-", "")} ${name}`;
    try {
      const r = (await ai.interactions.create({
        model,
        input: text,
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: "Orus" }] },
      } as never)) as { output_audio?: { data?: string; mime_type?: string } };
      if (!r.output_audio?.data) throw new Error("no audio");
      const raw = path.join(OUT, `slur3-${model}-${name}.raw`);
      const clip = path.join(OUT, `slur3-${model}-${name}.wav`);
      fs.writeFileSync(raw, Buffer.from(r.output_audio.data, "base64"));
      const mime = r.output_audio.mime_type ?? "";
      if (/l16|pcm/i.test(mime)) {
        // Headerless PCM: tell ffmpeg the format.
        const { execFileSync } = await import("node:child_process");
        const ff = (await import("ffmpeg-static")).default as unknown as string;
        execFileSync(ff, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", clip]);
      } else {
        await normalize(raw, clip);
      }
      fs.rmSync(raw, { force: true });
      const d = await decide({
        audio: { file: clip },
        questions: {
          slurred: { type: "noul", instructions: "Is the speaker's speech slurred?" },
          normal_speech: { type: "noul", instructions: "Is the speaker's speech clear, crisp, and normally paced?" },
        },
      });
      const n = (k: string) => (d.value[k].type === "noul" ? (d.value[k] as { noul: number }).noul.toFixed(2) : "?");
      console.log(`${label.padEnd(36)} slurred ${n("slurred")}  normal ${n("normal_speech")}  (${mime})  ${clip}`);
    } catch (e) {
      console.log(`${label.padEnd(36)} FAILED ${(e as Error).message.replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }
}
process.exit(0);
