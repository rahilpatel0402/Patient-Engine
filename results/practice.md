# Listening station results: practice set, written by Argon

Written by `scripts/write-results.ts` on 2026-11-21 18:57 UTC from the saved runs in `data/dev`. Every number is computed from those files. Counts are used, not percentages, because the sample is small. Every patient is synthetic.

## Clips

12 clips were generated. 8 are in the test and 4 were left out by the gate. The three arms were run on every generated clip, including the ones left out.

## Result on the clips in the test

| Arm | Hidden signs caught | Unclear, sent to physician review | False alarms on healthy controls |
|---|---|---|---|
| A. Transcript only | 0 of 6 | 0 | 0 of 2 |
| B. Raw audio | 6 of 6 | 0 | 0 of 2 |
| C. Transcript plus probes | 6 of 6 | 0 | 0 of 2 |

An unclear grade is one where the grader was under 0.7 confident either way. It is not counted as caught.

## By sign

| Sign | Generated | In the test | Gate | A caught | B caught | C caught |
|---|---|---|---|---|---|---|
| Short of breath | 2 | 2 | probe | 0 of 2 | 2 of 2 | 2 of 2 |
| Groaning or crying out | 2 | 2 | probe | 0 of 2 | 2 of 2 | 2 of 2 |
| Coughing | 2 | 2 | probe | 0 of 2 | 2 of 2 | 2 of 2 |
| Tearful or frightened | 2 | 0 | probe | 0 of 0 | 0 of 0 | 0 of 0 |
| Slurred speech | 2 | 0 | physician | 0 of 0 | 0 of 0 | 0 of 0 |

Slurred speech is gated differently from the other signs. Two models listen to each slurred clip, and a physician decides the ones they disagree on. Its counts are shown on their own row so they can be read apart from the probe-gated signs.

## Healthy controls by voice

| Control voice | Generated | In the test | A false alarms | B false alarms | C false alarms |
|---|---|---|---|---|---|
| plain | 1 | 1 | 0 of 1 | 0 of 1 | 0 of 1 |
| slow | 1 | 1 | 0 of 1 | 0 of 1 | 0 of 1 |

## Clips left out of the test

The arms were still run on these, so the effect of the gate is visible.

| Clip | Sign it was written to have | Why it was left out | A | B | C |
|---|---|---|---|---|---|
| dev-07-distress | Tearful or frightened | distressed only 0.67, needs 0.8 | missed | missed | caught |
| dev-08-distress | Tearful or frightened | distressed only 0.37, needs 0.8 | missed | missed | missed |
| dev-09-slurred | Slurred speech | waiting for a physician: the listeners are not sure or disagree (probe 0.60, second listener: clear) | missed | caught | caught |
| dev-10-slurred | Slurred speech | waiting for a physician: the listeners are not sure or disagree (probe 0.52, second listener: clear) | missed | missed | caught |

## Would a different pass mark change the result?

The pass mark of 0.80 was fixed before any result existed. This covers the probe-gated signs only.

| Pass mark | Clips kept | A caught | B caught | C caught |
|---|---|---|---|---|
| 0.50 | 7 of 8 | 0 of 7 | 6 of 7 | 7 of 7 |
| 0.60 | 7 of 8 | 0 of 7 | 6 of 7 | 7 of 7 |
| 0.70 | 6 of 8 | 0 of 6 | 6 of 6 | 6 of 6 |
| 0.80 (used) | 6 of 8 | 0 of 6 | 6 of 6 | 6 of 6 |
| 0.90 | 3 of 8 | 0 of 3 | 3 of 3 | 3 of 3 |
| No gate | 8 of 8 | 0 of 8 | 6 of 8 | 7 of 8 |

## Stress ladder

The same clips were degraded step by step and never re-rendered: phone quality (300 to 3400 Hz at 8 kHz), then room noise recorded at the venue (32.7 seconds), mixed in at set ratios of voice to noise. A sign is still heard while its own probe stays at 0.50 or higher. A rung holds while at least 75 in 100 sign clips are still heard. That rule was written before any exam rung was looked at. The arms were run at the clean rung, at the hardest rung that holds, and at the first rung that breaks. Slurred clips are left out of this table, because their probe is not their pass mark.

| Rung | Signs still heard | At 0.80 or higher | Controls with a false sign | A caught | B caught | C caught |  |
|---|---|---|---|---|---|---|---|
| Clean | 6 of 6 | 6 of 6 | 0 of 2 | 0 of 6 | 6 of 6 | 6 of 6 |  |
| Phone quality | 6 of 6 | 6 of 6 | 0 of 2 |  |  |  |  |
| Room noise, voice 10 dB above it | 6 of 6 | 5 of 6 | 0 of 2 |  |  |  |  |
| Room noise, voice 5 dB above it | 6 of 6 | 5 of 6 | 0 of 2 |  |  |  |  |
| Room noise as loud as the voice | 6 of 6 | 5 of 6 | 0 of 2 |  |  |  |  |
| Room noise 5 dB above the voice | 5 of 6 | 2 of 6 | 0 of 2 | 0 of 6 | 2 of 6 | 5 of 6 | hardest rung that holds |
| Room noise 10 dB above the voice | 1 of 6 | 0 of 6 | 0 of 2 | 0 of 6 | 0 of 6 | 1 of 6 | breaks here |
| Room noise 15 dB above the voice | 0 of 6 | 0 of 6 | 0 of 2 |  |  |  |  |

## Physician review queue

No graded note on a clip in the test was unclear.
