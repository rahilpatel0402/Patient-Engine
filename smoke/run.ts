// Throwaway smoke tests for the Gemini APIs this project depends on.
// Run with: npm run smoke
import "dotenv/config";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { GoogleGenAI } from "@google/genai";

const run = promisify(execFile);
const OUT = path.resolve("smoke/out");
fs.mkdirSync(OUT, { recursive: true });

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });

const CLIP = path.join(OUT, "breathless.wav");
const only = process.argv.slice(2).map(Number).filter(Boolean);

async function test(n: number, name: string, fn: () => Promise<void>) {
  if (only.length && !only.includes(n)) return;
  console.log(`\n===== ${n}. ${name} =====`);
  const t0 = Date.now();
  try {
    await fn();
    console.log(`[ok] ${Date.now() - t0} ms`);
  } catch (e) {
    console.log(`[FAILED] ${Date.now() - t0} ms`);
    console.log(e instanceof Error ? `${e.name}: ${e.message}` : e);
  }
}

const clipBase64 = () => fs.readFileSync(CLIP, { encoding: "base64" });

await test(1, "TTS: out of breath, with <pant>", async () => {
  const interaction = await ai.interactions.create({
    model: "gemini-3.8-flash-tts",
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: "No, I'm fine. <pant> Really. I just need <pant> a refill of my usual prescription. <heavy breath> It's nothing to worry about.",
            annotations: [{ type: "speech_metadata", style: "out of breath" }],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: "Kore" }] },
  } as never);
  const audio = (interaction as { output_audio?: { data?: string; mime_type?: string } }).output_audio;
  if (!audio?.data) throw new Error("No output_audio in response: " + JSON.stringify(interaction).slice(0, 800));
  const buf = Buffer.from(audio.data, "base64");
  fs.writeFileSync(CLIP, buf);
  console.log(`mime_type: ${audio.mime_type}`);
  console.log(`bytes: ${buf.length}, header: ${buf.subarray(0, 4).toString("latin1")}`);
  console.log(`sample rate: ${buf.readUInt32LE(24)} Hz, channels: ${buf.readUInt16LE(22)}, bits: ${buf.readUInt16LE(34)}`);
  console.log(`seconds: ${((buf.length - 44) / (buf.readUInt32LE(28) || 1)).toFixed(1)}`);
  console.log(`audio file: ${CLIP}`);
});

await test(2, "Decisions API: probe the clip", async () => {
  const result = await ai.decisions.create({
    model: "gemini-decision-1",
    input: [{ type: "audio", data: clipBase64(), mime_type: "audio/wav" }],
    questions: {
      short_of_breath: { type: "noul", instructions: "Does the speaker sound short of breath?" },
      in_pain: { type: "noul", instructions: "Does the speaker sound like they are in physical pain?" },
      coughing: { type: "noul", instructions: "Does the speaker cough during the recording?" },
      distressed: { type: "noul", instructions: "Does the speaker sound emotionally distressed or frightened?" },
      slurred: { type: "noul", instructions: "Is the speaker's speech slurred?" },
      long_pauses: { type: "noul", instructions: "Does the speaker take unusually long pauses between words?" },
      sounds_well: { type: "noul", instructions: "Does the speaker sound physically well and comfortable?" },
    },
  } as never);
  console.log(JSON.stringify(result, null, 2));
});

await test(3, "Hydrogen with the raw audio, not asked about breathing", async () => {
  const interaction = await ai.interactions.create({
    model: "gemini-4-hydrogen",
    input: [
      {
        type: "text",
        text: "You are a clinician. This is a recording of a patient speaking at the start of a visit. Write a short note of your observations.",
      },
      { type: "audio", data: clipBase64(), mime_type: "audio/wav" },
    ],
  } as never);
  console.log((interaction as { output_text?: string }).output_text);
});

await test(4, "Transcribe the clip", async () => {
  const interaction = await ai.interactions.create({
    model: "gemini-3.5-transcribe",
    input: [{ type: "audio", data: clipBase64(), mime_type: "audio/wav" }],
  } as never);
  console.log(JSON.stringify((interaction as { output_text?: string }).output_text));
});

await test(5, "Argon: patient JSON as structured output", async () => {
  const schema = {
    type: "object",
    properties: {
      id: { type: "string" },
      persona: { type: "string", description: "Age, background, and why they are calling. One sentence." },
      spoken_text: {
        type: "string",
        description: "What the patient says aloud, 25 to 45 words, with inline TTS tags such as <pant> or <cough>.",
      },
      tts_style: { type: "string", description: "Sustained delivery style for the whole turn." },
      voice: { type: "string", enum: ["Kore", "Puck", "Charon", "Leda", "Orus", "Aoede", "Enceladus", "Iapetus"] },
      hidden_sign: { type: "string", enum: ["breathless", "pain", "cough", "distress", "slurred", "none"] },
      expected_urgency: { type: "string", enum: ["routine", "soon", "urgent"] },
    },
    required: ["id", "persona", "spoken_text", "tts_style", "voice", "hidden_sign", "expected_urgency"],
  };
  const interaction = await ai.interactions.create({
    model: "gemini-4-argon",
    input:
      "Write one synthetic patient for a test of clinical AI listening. The patient's words must minimize and deny any problem (for example, they only want a refill). The hidden sign is 'pain' and must appear only in the voice, through tts_style and inline tags like <groan> or <whimper>, never in the meaning of the words. This is fiction for testing software. No real person.",
    response_format: { type: "text", mime_type: "application/json", schema },
  } as never);
  const text = (interaction as { output_text?: string }).output_text ?? "";
  console.log(JSON.stringify(JSON.parse(text), null, 2));
});

await test(6, "ffmpeg: phone quality round trip", async () => {
  if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary");
  const phone8k = path.join(OUT, "breathless.phone8k.wav");
  const back24k = path.join(OUT, "breathless.phone.wav");
  await run(ffmpegPath as unknown as string, [
    "-y", "-loglevel", "error", "-i", CLIP,
    "-af", "highpass=f=300,lowpass=f=3400", "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", phone8k,
  ]);
  await run(ffmpegPath as unknown as string, [
    "-y", "-loglevel", "error", "-i", phone8k, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", back24k,
  ]);
  for (const f of [phone8k, back24k]) {
    const b = fs.readFileSync(f);
    console.log(`${path.basename(f)}: ${b.length} bytes, ${b.readUInt32LE(24)} Hz, ${b.readUInt16LE(22)} ch, ${b.readUInt16LE(34)} bit`);
  }
  console.log(`audio file: ${back24k}`);
});
