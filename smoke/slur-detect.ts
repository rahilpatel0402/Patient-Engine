// Throwaway: which automatic listener agrees with the physician on slurred speech?
// Physician labels so far: lab 1, 2, 4 slurred. Lab 3 not slurred (slow).
import { loadSet, abs } from "../server/engine/build.ts";
import { MODELS, decide, generateJson, type Question } from "../server/lib/gemini.ts";

const QUESTIONS: Record<string, Question> = {
  q_current: {
    type: "noul",
    instructions: "Is the speaker's speech slurred?",
    criteria: {
      true_description: "Words are slurred, thick, or run together, as if sedated or impaired.",
      false_description: "Words are clearly articulated.",
    },
  },
  q_consonants: {
    type: "noul",
    instructions: "Listen to how the consonants are formed. Are they imprecise, mushy, or blurred, so that words smear into each other?",
    criteria: {
      true_description: "Consonants are imprecise or blurred. Speech sounds thick-tongued or drunk, even if the words can still be understood.",
      false_description: "Consonants are crisp and distinct. Speech that is only slow, tired, breathy, hoarse, or tearful still counts as no.",
    },
  },
  q_dysarthria: {
    type: "noul",
    instructions: "Would a clinician describe this person's speech as dysarthric or slurred?",
    criteria: {
      true_description: "Yes. Articulation is impaired: slurred, thick, or drunken-sounding speech.",
      false_description: "No. Articulation is normal, even if the person is slow, breathless, coughing, upset, or in pain.",
    },
  },
  q_drunk: { type: "noul", instructions: "Does the speaker sound drunk, sedated, or otherwise impaired in how they form words?" },
  q_scale: {
    type: "choice",
    instructions: "Which best describes the speaker's articulation?",
    criteria: {
      crisp: "Normal, clear articulation. May still be slow, breathless, hoarse, or emotional.",
      mildly_slurred: "Some words are slurred or imprecise.",
      clearly_slurred: "Most words are slurred, thick, or run together.",
    },
  },
};

const LISTENER_SCHEMA = {
  type: "object",
  properties: {
    articulation: { type: "string", description: "One sentence on how the words are articulated." },
    slurred: { type: "string", enum: ["no", "mild", "clear"] },
  },
  required: ["articulation", "slurred"],
};

const LABELS: Record<string, string> = {
  "slurred-lab-01-slurred": "YES",
  "slurred-lab-02-slurred": "YES",
  "slurred-lab-03-slurred": "no (slow)",
  "slurred-lab-04-slurred": "YES mild",
};

const patients = [...loadSet("slurred-lab"), ...loadSet("dev")];
const rows = await Promise.all(
  patients.map(async (p) => {
    const audio = { file: abs(p.clip) };
    const [d, ...listeners] = await Promise.all([
      decide({ audio, questions: QUESTIONS }),
      ...[MODELS.neon, MODELS.carbon, MODELS.hydrogen].map((model) =>
        generateJson<{ articulation: string; slurred: string }>({
          model,
          system: "You are listening to a short recording of a person speaking. Judge only the articulation of the words: are they slurred? Slow, breathless, hoarse, coughing, or tearful speech is not slurred unless the words themselves are blurred.",
          text: "Recording attached.",
          audio,
          schema: LISTENER_SCHEMA,
          thinking: "low",
        }).then((r) => r.value.slurred).catch(() => "ERR"),
      ),
    ]);
    const n = (k: string) => {
      const a = d.value[k];
      return a.type === "noul" ? a.noul.toFixed(2) : "";
    };
    const scale = d.value.q_scale;
    const slurP = scale.type === "choice" ? (1 - (scale.probabilities.crisp ?? 0)).toFixed(2) : "?";
    return [
      p.id.replace("slurred-", "").padEnd(18),
      (LABELS[p.id] ?? (p.hidden_sign === "slurred" ? "?" : "no")).padEnd(10),
      n("q_current").padStart(7), n("q_consonants").padStart(7), n("q_dysarthria").padStart(7), n("q_drunk").padStart(7), slurP.padStart(7),
      ...listeners.map((l) => l.padStart(7)),
    ].join(" ");
  }),
);
console.log(["clip".padEnd(18), "physician".padEnd(10), "current", " conson", "dysarth", "  drunk", "  scale", "   Neon", " Carbon", "Hydrogn"].join(" "));
rows.forEach((r) => console.log(r));
