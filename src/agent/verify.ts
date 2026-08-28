import { config } from "../config.js";
import { gemini, textOf, parseJson } from "./gemini.js";
import type { Opportunity, Rejection } from "../schema.js";

/**
 * VERIFY is the stage that makes this tool safe to rely on, and it is never cut.
 *
 * A model asked to list grant deadlines will invent some. A journalist who
 * misses a real call because this agent reported a fabricated date is worse off
 * than if the agent had never existed. So every opportunity is re-checked
 * against its own source page, and anything the source does not confirm is
 * DROPPED — with the reason recorded, not swallowed.
 *
 * The check deliberately asks a narrow question. Broad questions invite the
 * model to be helpful and fill gaps; a narrow one invites it to say no.
 */

const VERIFY_SYSTEM = `You are a fact-checker. You are given one claimed funding
opportunity and the URL it came from. Open that URL and answer only from what
that page actually says.

Return JSON:
{
  "open": boolean,          // is this call currently open for applications?
  "deadlineMatches": boolean, // does the page state the claimed deadline?
  "correctedDeadlineIso": string|null, // YYYY-MM-DD if the page states a different one
  "reason": string          // one sentence, citing what the page says
}

If you cannot open or read the page, return open:false and say so in reason.
Never infer a deadline that the page does not state. Being unable to confirm is
a correct and useful answer.`;

interface VerdictShape {
  open: boolean;
  deadlineMatches: boolean;
  correctedDeadlineIso: string | null;
  reason: string;
}

export interface VerifyResult {
  kept: Opportunity[];
  rejections: Rejection[];
}

async function checkOne(o: Opportunity): Promise<VerdictShape> {
  const ai = gemini();
  const response = await ai.models.generateContent({
    model: config.model,
    contents:
      `Claimed opportunity:\n` +
      `Organisation: ${o.organisation}\n` +
      `Programme: ${o.programme}\n` +
      `Claimed deadline: ${o.deadline.raw}\n` +
      `Source URL: ${o.sourceUrl}\n\n` +
      `Check this page and answer.`,
    config: {
      systemInstruction: VERIFY_SYSTEM,
      tools: [{ googleSearch: {} }],
      temperature: 0,
    },
  });

  const parsed = parseJson(textOf(response)) as Partial<VerdictShape>;
  return {
    open: parsed.open === true,
    deadlineMatches: parsed.deadlineMatches === true,
    correctedDeadlineIso: parsed.correctedDeadlineIso ?? null,
    reason: typeof parsed.reason === "string" ? parsed.reason : "no reason given",
  };
}

export async function verify(opportunities: Opportunity[]): Promise<VerifyResult> {
  const kept: Opportunity[] = [];
  const rejections: Rejection[] = [];

  // Sequential on purpose. A dozen concurrent grounded calls is how you meet a
  // Vertex quota error in the middle of a demo.
  for (const o of opportunities) {
    let verdict: VerdictShape;
    try {
      verdict = await checkOne(o);
    } catch (error) {
      // An unverifiable opportunity is dropped, never passed through. Failing
      // open here would defeat the entire point of this stage.
      rejections.push({
        stage: "verify",
        organisation: o.organisation,
        programme: o.programme,
        sourceUrl: o.sourceUrl,
        reason: `verification call failed: ${(error as Error).message}`,
      });
      continue;
    }

    if (!verdict.open) {
      rejections.push({
        stage: "verify",
        organisation: o.organisation,
        programme: o.programme,
        sourceUrl: o.sourceUrl,
        reason: verdict.reason,
      });
      continue;
    }

    if (!verdict.deadlineMatches && verdict.correctedDeadlineIso) {
      // The call is real but our date was wrong: correct it rather than lose it.
      kept.push({
        ...o,
        deadline: {
          iso: verdict.correctedDeadlineIso,
          raw: `${verdict.correctedDeadlineIso} (corrected during verification)`,
        },
      });
      continue;
    }

    if (!verdict.deadlineMatches) {
      rejections.push({
        stage: "verify",
        organisation: o.organisation,
        programme: o.programme,
        sourceUrl: o.sourceUrl,
        reason: `deadline could not be confirmed on the source page — ${verdict.reason}`,
      });
      continue;
    }

    kept.push(o);
  }

  return { kept, rejections };
}
