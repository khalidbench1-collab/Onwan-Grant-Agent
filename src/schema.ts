import { z } from "zod";

/**
 * The contract every stage of the pipeline works against.
 *
 * The single most important field is `sourceUrl`. Everything the digest tells a
 * journalist must be traceable back to a page they can open themselves — that
 * is what separates this from a model confidently listing plausible-sounding
 * grants. The verify stage re-reads that page; anything without a usable URL is
 * dropped before it gets there.
 */

export const AmountSchema = z.object({
  /** Normalised numeric value, if one could be read. Null when the call says "varies". */
  value: z.number().nullable(),
  /** ISO 4217 where known: EUR, USD, GBP. */
  currency: z.string().nullable(),
  /** Exactly what the source page said, e.g. "up to €25,000" or "travel costs covered". */
  raw: z.string(),
});

export const DeadlineSchema = z.object({
  /** YYYY-MM-DD. Null for rolling calls or when the date could not be pinned down. */
  iso: z.string().nullable(),
  /** The source's own wording, e.g. "rolling" or "15 October 2026, 23:59 CET". */
  raw: z.string(),
});

export const OpportunitySchema = z.object({
  organisation: z.string().min(1),
  programme: z.string().min(1),
  summary: z.string().min(1),
  amount: AmountSchema,
  deadline: DeadlineSchema,
  /** Who may apply — region, career stage, language, medium. */
  eligibility: z.string(),
  /** What the applicant must actually assemble. Drives the feasibility score. */
  requirements: z.array(z.string()),
  sourceUrl: z.string().url(),

  /*
   * Everything below is optional and defaulted.
   *
   * These fill the detail card in the digest, and a funder page that does not
   * state them is normal rather than exceptional. A required field here would
   * mean one silent page turning a whole run into a schema failure, so each
   * degrades to "not stated" and the digest simply omits that row.
   */

  /** The application portal, when it differs from the page the call was read from. */
  applyUrl: z.string().url().nullable().default(null),
  /** e.g. "Reporting November 2026 to April 2027". Null when the call says nothing. */
  duration: z.string().nullable().default(null),
  /** The language the application must be written in. */
  language: z.string().nullable().default(null),
  /** Ordered steps, quoted from the call's own instructions. Never invented. */
  howToApply: z.array(z.string()).default([]),
});

export type Amount = z.infer<typeof AmountSchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const DiscoveryResultSchema = z.object({
  opportunities: z.array(OpportunitySchema),
});

/** Why an opportunity did not reach the digest. Stored, not discarded. */
export type RejectionStage = "schema" | "verify" | "dedupe";

export interface Rejection {
  stage: RejectionStage;
  organisation: string;
  programme: string;
  sourceUrl: string;
  reason: string;
}
