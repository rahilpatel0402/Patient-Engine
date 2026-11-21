// Audio conversion and degradation with ffmpeg.
// Everything the models hear is 24 kHz mono 16-bit WAV. Degraded rungs are made
// from the same clip, never re-rendered.
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
export async function normalize(input: string, output: string): Promise<string> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await ffmpeg(["-i", input, ...WAV_OUT, output]);
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

/**
 * Mixes looped noise under the speech. `noiseGain` is linear: 0 is silent,
 * 1 is the noise file at its recorded level.
 */
export async function mixNoise(speech: string, noise: string, noiseGain: number, output: string): Promise<string> {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const filter = `[1:a]volume=${noiseGain.toFixed(3)}[n];[0:a][n]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`;
  await ffmpeg(["-i", speech, "-stream_loop", "-1", "-i", noise, "-filter_complex", filter, "-map", "[out]", ...WAV_OUT, output]);
  return output;
}

export function wavSeconds(file: string): number {
  const b = fs.readFileSync(file);
  const byteRate = b.readUInt32LE(28) || 48000;
  return Number(((b.length - 44) / byteRate).toFixed(1));
}
