# Listening station results: exam set, written by Carbon

Written by `scripts/write-results.ts` on 2026-11-21 19:50 UTC from the saved runs in `data/exam`. Every number is computed from those files. Counts are used, not percentages, because the sample is small. Every patient is synthetic.

## Clips

28 clips were generated. 24 are in the test and 4 were left out by the gate. The three arms were run on every generated clip, including the ones left out.

## Result on the clips in the test

| Arm | Hidden signs caught | False alarms on healthy controls |
|---|---|---|
| A. Transcript only | 0 of 16 | 0 of 8 |
| B. Raw audio | 12 of 16 (1 unclear) | 0 of 8 |
| C. Transcript plus probes | 15 of 16 | 0 of 8 (2 unclear) |

An unclear grade is one where the grader was under 0.7 confident either way. It is not counted as caught or as a false alarm, and it goes to physician review.

## By sign

| Sign | Generated | In the test | Gate | A caught | B caught | C caught |
|---|---|---|---|---|---|---|
| Short of breath | 4 | 3 | probe | 0 of 3 | 3 of 3 | 3 of 3 |
| Groaning or crying out | 4 | 4 | probe | 0 of 4 | 3 of 4 | 4 of 4 |
| Coughing | 4 | 4 | probe | 0 of 4 | 3 of 4 (1 unclear) | 4 of 4 |
| Tearful or frightened | 4 | 1 | probe | 0 of 1 | 1 of 1 | 1 of 1 |
| Slurred speech | 4 | 4 | physician | 0 of 4 | 2 of 4 | 3 of 4 |

Slurred speech is gated differently from the other signs. Two models listen to each slurred clip, and a physician decides the ones they disagree on. Its counts are shown on their own row so they can be read apart from the probe-gated signs. A physician heard slurred speech in 4 of the 4 slurred clips that the automatic listeners could not settle. The Decisions API had scored those 4 between 0.35 and 0.70 on slurred speech, every one under the 0.80 pass mark used for the other signs.

## Healthy controls by voice

| Control voice | Generated | In the test | A false alarms | B false alarms | C false alarms |
|---|---|---|---|---|---|
| plain | 5 | 5 | 0 of 5 | 0 of 5 | 0 of 5 (2 unclear) |
| slow | 1 | 1 | 0 of 1 | 0 of 1 | 0 of 1 |
| hoarse | 1 | 1 | 0 of 1 | 0 of 1 | 0 of 1 |
| cheerful | 1 | 1 | 0 of 1 | 0 of 1 | 0 of 1 |

## Clips left out of the test

The arms were still run on these, so the effect of the gate is visible.

| Clip | Sign it was written to have | Why it was left out | A | B | C |
|---|---|---|---|---|---|
| exam-02-breathless | Short of breath | short_of_breath only 0.79, needs 0.8 | missed | caught | caught |
| exam-13-distress | Tearful or frightened | distressed only 0.29, needs 0.8 | missed | caught | missed |
| exam-14-distress | Tearful or frightened | distressed only 0.24, needs 0.8 | missed | missed | missed |
| exam-15-distress | Tearful or frightened | distressed only 0.74, needs 0.8 | missed | missed | caught |

## Would a different pass mark change the result?

The pass mark of 0.80 was fixed before any result existed. This covers the probe-gated signs only.

| Pass mark | Clips kept | A caught | B caught | C caught |
|---|---|---|---|---|
| 0.50 | 14 of 16 | 0 of 14 | 11 of 14 (1 unclear) | 14 of 14 |
| 0.60 | 14 of 16 | 0 of 14 | 11 of 14 (1 unclear) | 14 of 14 |
| 0.70 | 14 of 16 | 0 of 14 | 11 of 14 (1 unclear) | 14 of 14 |
| 0.80 (used) | 12 of 16 | 0 of 12 | 10 of 12 (1 unclear) | 12 of 12 |
| 0.90 | 3 of 16 | 0 of 3 | 2 of 3 (1 unclear) | 3 of 3 |
| No gate | 16 of 16 | 0 of 16 | 12 of 16 (1 unclear) | 14 of 16 |

## Stress ladder

The same clips were degraded step by step and never re-rendered: phone quality (300 to 3400 Hz at 8 kHz), then room noise recorded at the venue (32.7 seconds), mixed in at set ratios of voice to noise. A sign is still heard while its own probe stays at 0.50 or higher. A rung holds while at least 75 in 100 sign clips are still heard. That rule was written before any exam rung was looked at. The arms were run at the clean rung, at the hardest rung that holds, and at the first rung that breaks. Slurred clips are left out of this table, because their probe is not their pass mark.

| Rung | Signs still heard | At 0.80 or higher | Controls with a false sign | A caught | B caught | C caught |  |
|---|---|---|---|---|---|---|---|
| Clean | 12 of 12 | 12 of 12 | 0 of 8 | 0 of 12 | 10 of 12 (1 unclear) | 12 of 12 |  |
| Phone quality | 12 of 12 | 9 of 12 | 0 of 8 |  |  |  |  |
| Room noise, voice 10 dB above it | 12 of 12 | 8 of 12 | 0 of 8 |  |  |  |  |
| Room noise, voice 5 dB above it | 12 of 12 | 8 of 12 | 0 of 8 |  |  |  |  |
| Room noise as loud as the voice | 12 of 12 | 7 of 12 | 0 of 8 | 0 of 12 | 9 of 12 | 12 of 12 | hardest rung that holds |
| Room noise 5 dB above the voice | 7 of 12 | 3 of 12 | 0 of 8 | 0 of 12 | 4 of 12 | 9 of 12 | breaks here |
| Room noise 10 dB above the voice | 2 of 12 | 1 of 12 | 0 of 8 |  |  |  |  |
| Room noise 15 dB above the voice | 0 of 12 | 0 of 12 | 0 of 8 |  |  |  |  |

## Blind physician labels

A physician heard 16 clips in random order under neutral names, with the sign hidden, before any exam result was shown. The physician named the sign the clip was written to have on 14 of 16. The automatic gate made its own call on 12 of the 16, and the physician agreed with it on 9. It handed the other 4 to the physician, who heard the sign in 4.

| Clip | Written to have | Physician heard | Automatic gate | Agree |
|---|---|---|---|---|
| exam-20-slurred | Slurred speech | Slurred speech | handed to the physician |  |
| exam-17-slurred | Slurred speech | Slurred speech | handed to the physician |  |
| exam-05-groaning | Groaning or crying out | Groaning or crying out | kept (probe) | yes |
| exam-14-distress | Tearful or frightened | Short of breath | not kept (probe) | yes |
| exam-12-cough | Coughing | Coughing | kept (probe) | yes |
| exam-18-slurred | Slurred speech | Slurred speech | handed to the physician |  |
| exam-04-breathless | Short of breath | Tearful or frightened | kept (probe) | no |
| exam-24-none | Healthy control | Healthy control | kept (probe) | yes |
| exam-13-distress | Tearful or frightened | Tearful or frightened | not kept (probe) | no |
| exam-07-groaning | Groaning or crying out | Groaning or crying out | kept (probe) | yes |
| exam-22-none | Healthy control | Healthy control | kept (probe) | yes |
| exam-26-none | Healthy control | Healthy control | kept (probe) | yes |
| exam-02-breathless | Short of breath | Short of breath | not kept (probe) | no |
| exam-19-slurred | Slurred speech | Slurred speech | handed to the physician |  |
| exam-27-none | Healthy control | Healthy control | kept (probe) | yes |
| exam-10-cough | Coughing | Coughing | kept (probe) | yes |

## Same test, four Gemini 4 models as the clinician

Same clips, same prompts, same grader. Only the clinician model changes. Two rows are not fully independent: the model that wrote this set's scripts, and Carbon, which is the second listener for slurred clips.

| Clinician model | A caught | B caught | C caught | False alarms on controls (A, B, C) |
|---|---|---|---|---|
| Gemini 4 Hydrogen (main run) | 0 of 16 | 12 of 16 (1 unclear) | 15 of 16 | 0 of 8 / 0 of 8 / 0 of 8 (2 unclear) |
| Gemini 4 Neon | 0 of 16 | 13 of 16 | 15 of 16 (1 unclear) | 0 of 8 / 0 of 8 / 0 of 8 (1 unclear) |
| Gemini 4 Argon | 0 of 16 | 14 of 16 (1 unclear) | 15 of 16 | 0 of 8 / 0 of 8 / 0 of 8 (2 unclear) |
| Gemini 4 Carbon | 0 of 16 | 14 of 16 | 16 of 16 | 0 of 8 / 0 of 8 / 0 of 8 (1 unclear) |

## Physician review queue

| Clip | Sign | Arm | Grader probability |
|---|---|---|---|
| exam-10-cough | Coughing | B | 0.31 |
| exam-21-none | Healthy control | C | 0.54 |
| exam-23-none | Healthy control | C | 0.42 |
