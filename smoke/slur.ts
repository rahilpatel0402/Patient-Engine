// Throwaway: can Gemini TTS produce speech that the listening model hears as slurred?
import * as fs from "node:fs";
import * as path from "node:path";
import { probe } from "../server/engine/probes.ts";
import { normalize } from "../server/lib/audio.ts";
import { speak, transcribe } from "../server/lib/gemini.ts";

const OUT = path.resolve("smoke/out");
fs.mkdirSync(OUT, { recursive: true });

const PLAIN =
  "Hey there. Everything is fine with me, just calling in from the job site <long pause> to get my regular refill sent over to the usual place. <long pause> No need to change anything, just the standard order whenever you have a minute. <long pause> Thanks.";
const PHONETIC =
  "Heyyy there. Evrythin's fiiine with me, jusss callin' in from the job sssite <long pause> to get my reg'lar refill ssent over to the uzhual playsh. <long pause> No need to shange anythin', jusss the shtandard order whenever you have a minute. <long pause> Thanksh.";

const STYLES: Record<string, string> = {
  drunk: "Extremely drunk and heavily intoxicated. Slurring every word, tongue thick and heavy, consonants mushy and smeared, words sliding into each other, slow and sloppy.",
  dysarthria: "Severe dysarthria, as after a stroke. Thick-tongued, slow, effortful speech with mushy imprecise consonants and words smeared together. One side of the mouth barely moving.",
  sedated: "Heavily sedated and barely awake. Mumbling, slurred, drawling speech, dragging every syllable, lips barely moving, trailing off.",
};

const variants: { name: string; text: string; style: string; voice: string }[] = [];
for (const [s, style] of Object.entries(STYLES)) {
  variants.push({ name: `${s}-plain-Orus`, text: PLAIN, style, voice: "Orus" });
  variants.push({ name: `${s}-phonetic-Orus`, text: PHONETIC, style, voice: "Orus" });
}
variants.push({ name: "drunk-phonetic-Charon", text: PHONETIC, style: STYLES.drunk, voice: "Charon" });
variants.push({ name: "dysarthria-phonetic-Algieba", text: PHONETIC, style: STYLES.dysarthria, voice: "Algieba" });

const rows = await Promise.all(
  variants.map(async (v) => {
    try {
      const audio = await speak({ text: v.text, style: v.style, voice: v.voice });
      const raw = path.join(OUT, `slur-${v.name}.raw.wav`);
      const clip = path.join(OUT, `slur-${v.name}.wav`);
      fs.writeFileSync(raw, Buffer.from(audio.value, "base64"));
      await normalize(raw, clip);
      fs.rmSync(raw, { force: true });
      const [p, t] = await Promise.all([probe({ file: clip }), transcribe({ file: clip })]);
      return { ...v, clip, probes: p.probes, transcript: t.value.trim() };
    } catch (e) {
      return { ...v, error: (e as Error).message.slice(0, 120) };
    }
  }),
);

for (const r of rows.sort((a, b) => ("probes" in b ? b.probes.slurred : -1) - ("probes" in a ? a.probes.slurred : -1))) {
  if ("error" in r) {
    console.log(`${r.name.padEnd(30)} FAILED ${r.error}`);
    continue;
  }
  const p = r.probes;
  console.log(
    `${r.name.padEnd(30)} slurred ${p.slurred.toFixed(2)}  pauses ${p.long_pauses.toFixed(2)}  well ${p.sounds_well.toFixed(2)}  breath ${p.short_of_breath.toFixed(2)}  distress ${p.distressed.toFixed(2)}`,
  );
  console.log(`   transcript: ${r.transcript}`);
}
