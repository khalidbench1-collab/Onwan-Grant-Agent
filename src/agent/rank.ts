import type { Opportunity } from "../schema.js";

/**
 * RANK is a plain function, not a model call.
 *
 * Three reasons: it is deterministic (the same digest twice), it is testable
 * (see test/rank.test.ts), and it is explainable — every entry in the email
 * carries the breakdown below, so the reader can disagree with the ranking
 * rather than having to trust it.
 */

export const WEIGHTS = {
  amount: 0.4,
  feasibility: 0.35,
  urgency: 0.25,
} as const;

export interface Score {
  total: number;
  amount: number;
  feasibility: number;
  urgency: number;
  /** Short human-readable reasons, shown under each entry in the digest. */
  notes: string[];
  /** High urgency on a heavy application: surfaced, but honestly labelled. */
  urgentButHeavy: boolean;
}

export interface Ranked {
  opportunity: Opportunity;
  score: Score;
}

/**
 * Money is log-scaled: €40,000 is meaningfully better than €4,000, but not ten
 * times better, because past a point the constraint is your time, not the grant.
 * An unstated amount scores low rather than zero — "amount on application" is
 * common and does not mean worthless.
 */
export function scoreAmount(o: Opportunity): number {
  const value = o.amount.value;
  if (value === null || Number.isNaN(value)) return 0.25;
  if (value <= 0) return 0.25;
  const CEILING = 50_000;
  return Math.min(1, Math.log10(value + 1) / Math.log10(CEILING));
}

/**
 * Urgency rises as the deadline approaches and falls off past it. A rolling or
 * unknown deadline sits mid-scale: it is neither urgent nor safe to ignore.
 */
export function scoreUrgency(o: Opportunity, today: Date): number {
  const iso = o.deadline.iso;
  if (!iso) return 0.5;
  const due = new Date(`${iso}T23:59:59Z`);
  if (Number.isNaN(due.getTime())) return 0.5;

  const days = (due.getTime() - today.getTime()) / 86_400_000;
  if (days < 0) return 0; // already closed
  if (days <= 7) return 1;
  if (days >= 120) return 0.1;
  return 1 - (days - 7) / (120 - 7);
}

/**
 * How much work the application actually is, as a 0–1 score where 1 means
 * "a pitch and a CV" and 0 means "a fiscal sponsor and three references".
 *
 * TODO(owner): implement this — see the request in the conversation.
 */
export function scoreFeasibility(_o: Opportunity): number {
  throw new Error("scoreFeasibility not implemented");
}

export function rank(opportunities: Opportunity[], today: Date): Ranked[] {
  return opportunities
    .map((opportunity) => {
      const amount = scoreAmount(opportunity);
      const feasibility = scoreFeasibility(opportunity);
      const urgency = scoreUrgency(opportunity, today);

      const notes: string[] = [];
      if (amount >= 0.75) notes.push("substantial award");
      if (feasibility >= 0.7) notes.push("light application");
      if (feasibility <= 0.35) notes.push("heavy application");
      if (urgency >= 0.85) notes.push("closing soon");
      if (opportunity.deadline.iso === null) notes.push("rolling or unstated deadline");

      // The interaction rule. Raw urgency would push a grant due in 48 hours to
      // the top even when the paperwork cannot be assembled in 48 hours. It
      // still surfaces — it is just labelled instead of silently promoted.
      const urgentButHeavy = urgency >= 0.85 && feasibility <= 0.35;

      const total =
        WEIGHTS.amount * amount +
        WEIGHTS.feasibility * feasibility +
        WEIGHTS.urgency * urgency;

      return {
        opportunity,
        score: { total, amount, feasibility, urgency, notes, urgentButHeavy },
      };
    })
    .sort((a, b) => b.score.total - a.score.total);
}
