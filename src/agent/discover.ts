import { config } from "../config.js";
import { gemini, textOf, parseJson } from "./gemini.js";
import { DiscoveryResultSchema, type Opportunity, type Rejection } from "../schema.js";

/**
 * DISCOVER runs as two calls, deliberately.
 *
 * Google Search grounding and a strict `responseSchema` do not reliably
 * coexist in one request: grounding wants to answer in prose with citations,
 * structured output wants to answer in JSON with neither. Forcing both tends
 * to produce JSON that quietly stopped searching.
 *
 * So: call one searches and writes prose with URLs. Call two — no tools, no
 * search, nothing to distract it — turns that prose into JSON matching our
 * schema. The second call is an extractor, not a researcher, and is told it
 * may not add anything the first call did not say.
 */

const SEARCH_PROMPT = `Today is {TODAY}. You are researching funding opportunities
for working journalists.

Search the web and find calls — grants, fellowships, residencies, reporting
stipends and travel grants — that a freelance journalist BASED IN GERMANY or
elsewhere in the EU can apply for RIGHT NOW.

The single hardest requirement: the call must be ACCEPTING APPLICATIONS TODAY.
A famous programme whose round has closed is worthless here. Before you list
anything, check the page for words like "closed", "paused", "next call opens",
"applications have ended" — and if you find them, do not list it.

Do not stop at the four or five best-known European journalism funds. Those are
usually between rounds. Search widely and specifically, for example:
- "call for applications" journalism grant {YEAR} deadline
- Recherchestipendium / Journalistenstipendium / Medienstipendium Bewerbung
- journalism residency open call apply
- reporting grant "applications are open"
- environmental / investigative / data journalism fellowship deadline {NEXT_MONTHS}
Search in German as well as English — German-language funders are under-indexed
in English results and are exactly the ones open to someone based in Germany.

Also include rolling or continuously-open programmes (no fixed deadline). Those
are valuable precisely because they are always available; say "rolling" as the
deadline.

Prioritise:
- calls whose deadline falls AFTER {TODAY}
- European and German funders, plus international funders open to EU applicants
- opportunities for individual journalists rather than newsrooms or institutions

For each opportunity you find, write a short block containing:
- the funding organisation
- the exact programme name
- what it funds, in one or two sentences
- the amount, quoted exactly as the source states it
- the application deadline, quoted exactly as the source states it
- who is eligible (region, career stage, language, medium)
- what the applicant must submit (pitch, CV, budget, reference letters, etc.)
- the direct URL of the page you took this from

Rules:
- Only include an opportunity if you have an actual source URL for it.
- Never guess a deadline or an amount. If a page does not state one, say so.
- Prefer the funder's own page over an aggregator's summary.

Find as many as you can, up to 15. A shorter list of genuinely open calls beats
a longer list padded with closed ones — every entry is independently verified
after you, and closed entries are thrown away.`;

const EXTRACT_SYSTEM = `You convert research notes into JSON.

You are an extractor, not a researcher. You may not add any organisation,
programme, amount, deadline or URL that does not appear in the notes you are
given. If a field is not stated in the notes, use null (for amount.value,
amount.currency, deadline.iso) or copy the note's own wording into the raw
field. Today's date is {TODAY}; use it only to resolve relative dates like
"end of next month" that the notes state explicitly.`;

const responseSchema = {
  type: "object",
  properties: {
    opportunities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          organisation: { type: "string" },
          programme: { type: "string" },
          summary: { type: "string" },
          amount: {
            type: "object",
            properties: {
              value: { type: "number", nullable: true },
              currency: { type: "string", nullable: true },
              raw: { type: "string" },
            },
            required: ["value", "currency", "raw"],
          },
          deadline: {
            type: "object",
            properties: {
              iso: { type: "string", nullable: true },
              raw: { type: "string" },
            },
            required: ["iso", "raw"],
          },
          eligibility: { type: "string" },
          requirements: { type: "array", items: { type: "string" } },
          sourceUrl: { type: "string" },
        },
        required: [
          "organisation",
          "programme",
          "summary",
          "amount",
          "deadline",
          "eligibility",
          "requirements",
          "sourceUrl",
        ],
      },
    },
  },
  required: ["opportunities"],
} as const;

export interface DiscoverResult {
  opportunities: Opportunity[];
  rejections: Rejection[];
  /** The grounded prose, kept for the run record so a bad digest is debuggable. */
  notes: string;
}

export async function discover(today: string): Promise<DiscoverResult> {
  const ai = gemini();

  const soon = new Date(today);
  soon.setMonth(soon.getMonth() + 3);
  const prompt = SEARCH_PROMPT.replaceAll("{TODAY}", today)
    .replaceAll("{YEAR}", today.slice(0, 4))
    .replaceAll("{NEXT_MONTHS}", `${today.slice(0, 7)} to ${soon.toISOString().slice(0, 7)}`);

  const searched = await ai.models.generateContent({
    model: config.model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.3,
    },
  });

  const notes = textOf(searched);
  if (!notes) {
    return { opportunities: [], rejections: [], notes: "" };
  }

  const extracted = await ai.models.generateContent({
    model: config.model,
    contents: `Research notes:\n\n${notes}`,
    config: {
      systemInstruction: EXTRACT_SYSTEM.replace("{TODAY}", today),
      responseMimeType: "application/json",
      responseSchema: responseSchema as unknown as Record<string, unknown>,
      temperature: 0,
    },
  });

  const parsed = DiscoveryResultSchema.safeParse(parseJson(textOf(extracted)));
  if (!parsed.success) {
    // A malformed extraction is a bug in our prompt, not a rejectable
    // opportunity — surface it rather than silently sending an empty digest.
    throw new Error(`Discovery output failed schema validation: ${parsed.error.message}`);
  }

  return { opportunities: parsed.data.opportunities, rejections: [], notes };
}
