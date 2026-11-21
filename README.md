# Patient Engine

An exam for clinical AI's senses, run in stations like a medical school exam.

A patient says "I'm fine, I just need a refill" while gasping for air. A transcript keeps the words and loses the voice. Station 1, Listening, measures three things:

1. What Gemini 4 hears that a transcript loses.
2. How far that holds up under noise.
3. Whether one fast listening call can repair a pipeline that only reads text.

Every patient is synthetic. No PHI. This is a test harness for AI. It does not give medical advice, and live mode shows only what the model observed.

Built solo at the Gemini 4 NYC hackathon on Saturday, November 21, 2026, for Problem Statement Two (Element 119).

## Results

<!-- results:start -->

Carbon wrote 28 exam patients. 24 are in the test: 16 with a hidden sign and 8 healthy controls. 4 were left out by the gate, and their results are reported too.

| Arm | What the clinician model is given | Hidden signs caught | False alarms on healthy controls |
|---|---|---|---|
| A. Transcript only | The transcript | 0 of 16 | 0 of 8 |
| B. Raw audio | The raw audio | 12 of 16 (1 unclear) | 0 of 8 |
| C. Transcript plus probes | The transcript, with seven probe probabilities from the Decisions API added | 15 of 16 | 0 of 8 (2 unclear) |

3 graded notes were unclear to the grader. They are not counted as caught or as false alarms, and they are listed in the review queue.

### By sign

| Sign | Generated | In the test | Gate | A caught | B caught | C caught |
|---|---|---|---|---|---|---|
| Short of breath | 4 | 3 | probe | 0 of 3 | 3 of 3 | 3 of 3 |
| Groaning or crying out | 4 | 4 | probe | 0 of 4 | 3 of 4 | 4 of 4 |
| Coughing | 4 | 4 | probe | 0 of 4 | 3 of 4 (1 unclear) | 4 of 4 |
| Tearful or frightened | 4 | 1 | probe | 0 of 1 | 1 of 1 | 1 of 1 |
| Slurred speech | 4 | 4 | physician | 0 of 4 | 2 of 4 | 3 of 4 |

A physician heard slurred speech in 4 of the 4 slurred clips that the automatic listeners could not settle. The Decisions API had scored those 4 between 0.35 and 0.70 on slurred speech, every one under the 0.80 pass mark used for the other signs.

### How far before it broke

| Rung | Signs the Decisions API still hears | A caught | B caught | C caught |  |
|---|---|---|---|---|---|
| Clean | 12 of 12 | 0 of 12 | 10 of 12 (1 unclear) | 12 of 12 |  |
| Phone quality | 12 of 12 |  |  |  |  |
| Room noise, voice 10 dB above it | 12 of 12 |  |  |  |  |
| Room noise, voice 5 dB above it | 12 of 12 |  |  |  |  |
| Room noise as loud as the voice | 12 of 12 | 0 of 12 | 9 of 12 | 12 of 12 | hardest rung that holds |
| Room noise 5 dB above the voice | 7 of 12 | 0 of 12 | 4 of 12 | 9 of 12 | breaks here |
| Room noise 10 dB above the voice | 2 of 12 |  |  |  |  |
| Room noise 15 dB above the voice | 0 of 12 |  |  |  |  |

At the hardest rung that still held, the raw audio arm caught 9 of 12 signs and the transcript plus probes arm caught 12 of 12. This table covers the probe-gated signs. The arms were run at the clean rung and at the two rungs a fixed rule picked.

### Blind physician labels

A physician heard 16 exam clips in random order with the sign hidden, before any exam result was shown. The physician named the sign the clip was written to have on 14 of 16. The automatic gate made its own call on 12 of the 16, and the physician agreed with it on 9. It handed the other 4 to the physician, who heard the sign in 4.

### Same test, four Gemini 4 models as the clinician

| Clinician model | A caught | B caught | C caught | False alarms on controls (A, B, C) |
|---|---|---|---|---|
| Gemini 4 Hydrogen (main run) | 0 of 16 | 12 of 16 (1 unclear) | 15 of 16 | 0 of 8 / 0 of 8 / 0 of 8 (2 unclear) |
| Gemini 4 Neon | 0 of 16 | 13 of 16 | 15 of 16 (1 unclear) | 0 of 8 / 0 of 8 / 0 of 8 (1 unclear) |
| Gemini 4 Argon | 0 of 16 | 14 of 16 (1 unclear) | 15 of 16 | 0 of 8 / 0 of 8 / 0 of 8 (2 unclear) |
| Gemini 4 Carbon | 0 of 16 | 14 of 16 | 16 of 16 | 0 of 8 / 0 of 8 / 0 of 8 (1 unclear) |

Full tables, the clips left out of the test, the pass mark table, and the review queue are in [results/listening.md](results/listening.md). The raw numbers are in [results/listening.json](results/listening.json).

<!-- results:end -->

## How the test works

1. **A model writes the patient.** The words always deny any problem. One hidden sign lives only in the voice.
2. **A voice model speaks it.** The result is a clip of 12 to 32 seconds.
3. **A gate checks the clip.** The Decisions API listens and answers seven yes or no questions about the voice. A clip is used only if its own sign comes through.
4. **Three arms run on the same clinician model.** Each arm gives the model a different view of the same patient.
5. **A grader reads each note.** The Decisions API decides whether the note names the hidden sign.
6. **A physician labels clips blind.** This is the one check that does not come from a Gemini model.
7. **The clips are degraded step by step.** Phone quality, then noise recorded in the room, until the listening breaks.

### The three arms

| Arm | What the clinician model is given | What it stands for |
|---|---|---|
| A. Transcript only | The transcript | How most pipelines work today |
| B. Raw audio | The audio clip | What the model hears with no help |
| C. Transcript plus probes | The transcript, with seven probe probabilities from the Decisions API typed underneath | The repair: a text pipeline with one listening call added |

### The signs

Every sign is something a listener can hear. None is a diagnosis, and none depends on what the patient says.

| Sign | What the listener hears | How a clip gets into the test |
|---|---|---|
| Short of breath | Panting, gasping, running out of air | Its probe scores 0.80 or higher |
| Groaning or crying out | Groans, moans, sharp cries | Its probe scores 0.80 or higher |
| Coughing | Coughs, throat clearing | Its probe scores 0.80 or higher |
| Tearful or frightened | A shaky, tearful voice | Its probe scores 0.80 or higher |
| Slurred speech | Slurred, thick, run-together words | Two models listen. A physician decides the clips they disagree on |
| Healthy control | Nothing | Every sign probe stays at 0.30 or lower |

Three of the eight exam controls have a harmless voice trait: a slow talker, a gravelly voice, and a cheerful person who laughs. A model that flags those is raising a false alarm.

The pass mark of 0.80 is a design choice made before any result existed. It is not a clinical cut-off. The results show what every other pass mark would have given.

## Models and their jobs

| Model | ID | Job |
|---|---|---|
| Gemini 4 Argon | `gemini-4-argon` | Writes the practice patients |
| Gemini 4 Carbon | `gemini-4-carbon` | Writes the exam patients, so the exam is not written by the model that wrote the practice set. Also the second listener for slurred clips |
| Gemini 4 Hydrogen | `gemini-4-hydrogen` | The clinician under test, at low thinking. It runs all three arms |
| Gemini 4 Neon | `gemini-4-neon` | An extra clinician under test, for the model comparison |
| Gemini Decision 1 | `gemini-decision-1` | The Decisions API. Four jobs: the perception probes, the gate on every clip, the grader, and the confidence check that sends unclear grades to a physician |
| Gemini 3.8 Flash TTS | `gemini-3.8-flash-tts` | The patient voices |
| Gemini 3.1 Flash TTS | `gemini-3.1-flash-tts-preview` | The voices for slurred and groaning patients, which the newer voice model does not render reliably |
| Gemini 3.5 Transcribe | `gemini-3.5-transcribe` | The transcript a real pipeline would get |

## What was built during the event

Planning was done before the event: the idea, the station design, and written notes. No code existed before 10:30 AM on event day. All code in this repository was written on site, and the commit history shows the build one step at a time.

One thing was tried before the event: a single breathless voice sample, made by hand in Google AI Studio, to check that the voice model could do it at all. No code or audio from that is in this repository.

The builder is a physician. The test design and every clinical call are theirs. The code was written on site with an AI coding agent, Claude Code. Everything the product does at runtime is Gemini.

| Station | What it tests | Status |
|---|---|---|
| 1. Listening | Does the model hear what a transcript loses? | Built and evaluated today |
| 2. Looking | Does the model see what a description loses? | Not built. Roadmap |
| 3. Examining | Can the model guide an exam and read the result? | Not built. Roadmap |
| 4. History | Can the model interview a patient who minimizes? | Not built. Roadmap |

Station 1, built today:

- The patient engine: author, voice, audio conversion, probes and gate.
- The three arms, the grader, and the physician review queue.
- The app: patient list, audio, transcript, three notes side by side, probe bars.
- Live mode: record from the mic, and see observations only.
- The exam set and a blind labelling page. Exam results stay hidden in the app until the physician's labels are saved.
- The stress ladder, with noise recorded in the room.
- The model comparison across four Gemini 4 models.

## What broke, and what changed

These came up during the build. Each one changed the test.

- **Pain is not something you can hear.** The first design had a sign called "pain". Pain is what a patient reports, and these patients deny it. What a listener can hear is groaning or crying out, so that became the sign.
- **The voice model does not slur, and the listening model under-hears slurring.** The newer voice model slows down but keeps articulating clearly, so an older Gemini voice model speaks the slurred patients. On four lab clips a physician heard slurred speech in three. The Decisions API scored those three 0.72, 0.65 and 0.34, all under the pass mark. So slurred speech has its own gate: two models listen, and a physician decides when they disagree. The lab clips and verdicts are in `data/slurred-lab`.
- **A grader that is unsure must not count as a catch.** An early version counted any grade above 0.5 as caught. Notes that never named the sign were being counted. A grade now counts only when the grader is at least 0.70 confident. Anything in between is unclear and goes to physician review.
- **Low probabilities read like detections.** In live mode the transcript plus probes arm listed every probe as "detected", including ones at 0.36. It now reports only signs at 0.50 or higher, in plain words, and the bars say what the numbers mean.
- **Noise has to be set relative to the voice.** Mixing noise at a fraction of its recorded level meant the same setting was a different difficulty on every clip. Noise is now mixed at an exact ratio of voice to noise, measured per clip.

## Limits

- **Synthetic voices.** This shows whether a model can use vocal cues at all. It says nothing yet about real patients.
- **One simulator.** Every voice comes from Gemini TTS. The results may partly reflect how that voice model renders a sign.
- **Small sample.** Results are reported as counts, never percentages.
- **One sign per patient.** Each test patient is written with a single hidden sign, so a catch or a miss is unambiguous. Real patients can show several at once. The clinician model's note is free to report anything it hears, but the grader only asks about the one sign the patient was written to have, so a correct extra finding earns no credit.
- **The gate and the repair share a model.** The Decisions API selects the clips and also supplies the probes in arm C. On clean audio arm C is high by construction, so the repair is judged under noise. Results on the clips the gate left out are reported, and the pass mark table shows every alternative.
- **One physician, who is also the builder.** The exam labels are collected blind, before any exam result is shown. The four lab verdicts on slurred speech were not blind.
- **Slurred means one kind of slurring.** The voice is told to sound heavily intoxicated. That is not stroke dysarthria or any other pattern.
- **Urgency is shown but not scored.** Each note carries an urgency, and no physician has validated what the right urgency is for each clip.
- **One room, one recording.** The stress ladder uses a single noise recording from the venue.

## What is not in this repository

- The room noise recording, the live mic recordings, and the noisy mixes. They can contain real voices.
- Any API key.

The transcripts of noisy clips are in the repository. A transcription model working under room noise can pick up a stray word from the room.

## Run it

Requires Node 20 or later.

```
npm install
cp .env.example .env    # then add your Gemini API key
npm run dev
```

The app runs on http://localhost:5173 and the server on http://localhost:8787.

The saved runs open without spending any API calls. Live mode needs a key. The noise slider and the stress ladder also need a room noise recording of your own, uploaded on the Live mic tab.

To rebuild from scratch:

```
npx tsx scripts/build-set.ts dev         # Argon writes 12 practice patients
npx tsx scripts/run-station1.ts dev      # three arms and the grader
npx tsx scripts/build-set.ts exam        # Carbon writes 28 exam patients
npx tsx scripts/run-station1.ts exam
npx tsx scripts/run-ladder.ts exam       # needs a room noise recording
npx tsx scripts/compare-models.ts exam
npx tsx scripts/write-results.ts exam    # writes results/ and the Results section above
```

Model results are cached in `cache/`, so a rerun on the same clips repeats nothing. Rebuilding a set renders new audio, so its numbers will differ from the ones here.

## Repository map

| Path | What is in it |
|---|---|
| `server/engine` | Patient author, voice, probes, gate |
| `server/station1` | The three arms, the grader, live mode, blind labels, result summaries |
| `server/lib` | Gemini API wrappers, audio conversion and mixing, the disk cache |
| `client` | The React app |
| `scripts` | One script per step of the test |
| `data` | Patients, clips and saved runs for each set |
| `results` | The written results |
| `cache` | Every model result, keyed by a hash of its inputs |
| `smoke` | Throwaway checks of the APIs |

## Roadmap

- Consented recordings from standardized patient actors, in place of synthetic voices.
- Patients with more than one sign, graded sign by sign against physician labels.
- Stations 2, 3 and 4.
- More kinds of slurred speech, validated by more than one physician.
- Overlapping speakers, accents and other languages on the stress ladder.
