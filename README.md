# Patient Engine

An exam for clinical AI's senses, run in stations like a medical school exam.

Station 1, Listening: a synthetic patient says "I'm fine" while the voice says otherwise. Does Gemini 4 hear what a transcript loses, where does that break, and can it be repaired?

Built at the Gemini 4 NYC hackathon on Saturday, November 21, 2026. Planning was done before the event. All code in this repository was written on site, starting at 10:30 AM.

Every patient is synthetic. No PHI. This is a test harness for AI, not medical advice.

## Status

Work in progress. This README is rewritten with real results before submission.

## Run it

Requires Node 20 or later.

```
npm install
cp .env.example .env    # then add your Gemini API key
npm run dev
```

The client runs on http://localhost:5173 and the server on http://localhost:8787.
