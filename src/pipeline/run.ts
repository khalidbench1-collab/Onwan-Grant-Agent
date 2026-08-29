import { discover } from "../agent/discover.js";
import { verify } from "../agent/verify.js";
import { rank } from "../agent/rank.js";
import { dedupe, remember, claimRun, finishRun, saveDigest } from "../store/firestore.js";
import { renderDigest, MAX_PER_DIGEST } from "../email/digest.js";
import { sendDigest } from "../email/resend.js";
import type { Rejection } from "../schema.js";

export interface RunOutcome {
  runId: string;
  status: "sent" | "empty" | "duplicate" | "failed";
  found: number;
  kept: number;
  rejections: Rejection[];
  emailId?: string;
  error?: string;
}

/**
 * The orchestrator. Each stage narrows the set, and every drop is recorded with
 * the reason it was dropped — that record is the evidence the agent is making
 * judgements rather than forwarding search results.
 */
export async function runPipeline(runId: string): Promise<RunOutcome> {
  const claimed = await claimRun(runId);
  if (!claimed) {
    // A Cloud Scheduler retry of a trigger already being handled. Exiting here
    // is the difference between a reliable schedule and duplicate mail.
    return { runId, status: "duplicate", found: 0, kept: 0, rejections: [] };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const rejections: Rejection[] = [];
  let found = 0;

  try {
    console.log(`[${runId}] discover`);
    const discovered = await discover(today);
    found = discovered.opportunities.length;
    rejections.push(...discovered.rejections);
    console.log(`[${runId}] discovered ${discovered.opportunities.length}`);

    console.log(`[${runId}] verify`);
    const verified = await verify(discovered.opportunities);
    rejections.push(...verified.rejections);
    console.log(`[${runId}] verified ${verified.kept.length}, dropped ${verified.rejections.length}`);

    console.log(`[${runId}] dedupe`);
    const deduped = await dedupe(verified.kept);
    rejections.push(...deduped.rejections);
    console.log(`[${runId}] fresh ${deduped.fresh.length}`);

    if (deduped.fresh.length === 0) {
      await finishRun(runId, "empty", { found: discovered.opportunities.length, rejections });
      return {
        runId,
        status: "empty",
        found: discovered.opportunities.length,
        kept: 0,
        rejections,
      };
    }

    // Cap BEFORE remembering. Anything past the cap is deliberately left
    // unseen, so it surfaces in a later digest instead of being marked sent and
    // lost — the reason this slice does not live in the renderer.
    const ranked = rank(deduped.fresh, now).slice(0, MAX_PER_DIGEST);
    const sent = ranked.map((r) => r.opportunity);
    console.log(`[${runId}] sending ${ranked.length} of ${deduped.fresh.length} fresh`);
    const html = renderDigest(ranked, rejections, today);
    const subject = `Onwan Grants — ${ranked.length} open call${ranked.length === 1 ? "" : "s"} for you`;

    const emailId = await sendDigest(subject, html);

    // Only remember after a successful send. Marking them seen first would
    // mean a failed send silently loses those calls forever.
    await remember(sent, runId);

    await saveDigest(runId, {
      sentAt: new Date().toISOString(),
      subject,
      emailId,
      entries: ranked.map((r) => ({
        organisation: r.opportunity.organisation,
        programme: r.opportunity.programme,
        deadline: r.opportunity.deadline.raw,
        amount: r.opportunity.amount.raw,
        sourceUrl: r.opportunity.sourceUrl,
        score: r.score.total,
        urgentButHeavy: r.score.urgentButHeavy,
      })),
      rejections,
    });

    await finishRun(runId, "sent", {
      found: discovered.opportunities.length,
      kept: ranked.length,
      emailId,
    });

    return {
      runId,
      status: "sent",
      found: discovered.opportunities.length,
      kept: ranked.length,
      rejections,
      emailId,
    };
  } catch (error) {
    const message = (error as Error).message;
    console.error(`[${runId}] failed:`, message);
    await finishRun(runId, "failed", { error: message, found, rejections });
    return { runId, status: "failed", found, kept: 0, rejections, error: message };
  }
}
