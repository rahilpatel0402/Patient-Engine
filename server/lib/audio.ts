// Audio conversion and degradation.
// Everything the models hear is 24 kHz mono 16-bit WAV. Degraded rungs are made
// from the same clip, never re-rendered. Format conversion uses ffmpeg. Noise
// mixing is done on the samples directly, so the voice-to-noise ratio is exact.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const run = promisify(execFile);
const FFMPEG = ffmpegStatic as unknown as string;
const WAV_OUT = ["-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le"];

async function ffmpeg(args: string[]): Promise<void> {
  await run(FFMPEG, ["-y", "-loglevel", "error", ...args]);
}

/** Any input format (webm, opus, m4a, wav) to 24 kHz mono 16-bit WAV. */
export async function normalize(input: string, output: string, opts: { rawPcm?: boolean } = {}): Promise<string> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Headerless 16-bit PCM has no container, so ffmpeg must be told the format.
  const format = opts.rawPcm ? ["-f", "s16le", "-ar", "24000", "-ac", "1"] : [];
  await ffmpeg([...format, "-i", input, ...WAV_OUT, output]);
  return output;
}

/** Phone quality: 300 to 3400 Hz band-pass at 8 kHz, then back to the standard WAV. */
export async function phoneQuality(input: string, output: string): Promise<string> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const narrow = output.replace(/\.wav$/, ".8k.wav");
  await ffmpeg(["-i", input, "-af", "highpass=f=300,lowpass=f=3400", "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", narrow]);
  await ffmpeg(["-i", narrow, ...WAV_OUT, output]);
  fs.rmSync(narrow, { force: true });
  return output;
}

// ---- samples -------------------------------------------------------------------

export type Wav = { rate: number; samples: Int16Array };

/** Reads a mono 16-bit WAV. Walks the chunks, since ffmpeg writes extra ones before the audio. */
export function readWav(file: string): Wav {
  const b = fs.readFileSync(file);
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") throw new Error(`${path.basename(file)} is not a WAV file`);
  let off = 12;
  let rate = 24000;
  let channels = 1;
  let bits = 16;
  while (off + 8 <= b.length) {
    const id = b.toString("latin1", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(off + 10);
      rate = b.readUInt32LE(off + 12);
      bits = b.readUInt16LE(off + 22);
    }
    if (id === "data") {
      if (channels !== 1 || bits !== 16) throw new Error(`${path.basename(file)} must be mono 16-bit. Normalize it first.`);
      const n = Math.floor(Math.min(len, b.length - off - 8) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(off + 8 + i * 2);
      return { rate, samples };
    }
    off += 8 + len + (len % 2);
  }
  throw new Error(`${path.basename(file)} has no audio data`);
}

export function writeWav(file: string, rate: number, samples: Int16Array): void {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(samples.length * 2, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]));
}

const toDb = (rms: number) => 20 * Math.log10(Math.max(rms, 1e-9) / 32768);

function rmsOf(samples: ArrayLike<number>, n = samples.length): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, n));
}

export function wavSeconds(file: string): number {
  const w = readWav(file);
  return Number((w.samples.length / w.rate).toFixed(1));
}

/** Average level of a clip in dBFS, measured over the whole clip. */
export function levelDb(file: string): number {
  return Number(toDb(rmsOf(readWav(file).samples)).toFixed(1));
}

/**
 * Mixes looped room noise under speech at a chosen signal-to-noise ratio.
 *
 * snrDb is how many decibels the voice sits above the noise. 10 is a quiet room,
 * 0 is noise as loud as the voice, and a negative value is noise louder than the
 * voice. Both levels are measured over the whole clip, so the ratio is the same
 * for every clip however loud the clip or the noise recording happens to be.
 */
export function mixAtSnr(speechFile: string, noiseFile: string, snrDb: number, output: string): { noise_gain: number; turned_down: number } {
  const speech = readWav(speechFile);
  const noise = readWav(noiseFile);
  if (speech.rate !== noise.rate) throw new Error("Speech and noise must have the same sample rate. Normalize both first.");
  if (!noise.samples.length) throw new Error("The noise recording is empty.");
  const n = speech.samples.length;

  // The stretch of noise that sits under this clip, looped if the clip is longer.
  const bed = new Float64Array(n);
  for (let i = 0; i < n; i++) bed[i] = noise.samples[i % noise.samples.length];

  const speechRms = rmsOf(speech.samples);
  const noiseRms = rmsOf(bed);
  const gain = noiseRms > 0 ? speechRms / noiseRms / 10 ** (snrDb / 20) : 0;

  const mixed = new Float64Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    mixed[i] = speech.samples[i] + gain * bed[i];
    peak = Math.max(peak, Math.abs(mixed[i]));
  }
  // If the sum would clip, turn the whole mix down. That keeps the ratio intact.
  const scale = peak > 32000 ? 32000 / peak : 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(mixed[i] * scale);
  writeWav(output, speech.rate, out);
  return { noise_gain: Number(gain.toFixed(4)), turned_down: Number(scale.toFixed(4)) };
}
