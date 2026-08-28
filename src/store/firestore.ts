import { createHash } from "node:crypto";
import { Firestore } from "@google-cloud/firestore";
import { config } from "../config.js";
import type { Opportunity, Rejection } from "../schema.js";

/**
 * Collections are namespaced under `grants_` so this service can share the
 * Google Cloud project with the existing Onwan backend without any chance of
 * touching its entitlement data.
 */
const SEEN = "grants_seen";
const RUNS = "grants_runs";
const DIGESTS = "grants_digests";

let db: Firestore | null = null;
function store(): Firestore {
  if (!db) db = new Firestore({ projectId: config.projectId });
  return db;
}

/**
 * Identity is the funder plus the programme name — NOT the URL.
 *
 * The same fellowship appears on the funder's site, on two aggregators and in a
 * newsletter, each with a different URL and tracking parameters. Hashing URLs
 * would dedupe nothing in exactly the case that matters. Normalising the name
 * catches "Grant" vs "grant" and stray punctuation.
 */
export function fingerprint(o: Pick<Opportunity, "organisation" | "programme">): string {
  const normalise = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return createHash("sha256")
    .update(`${normalise(o.organisation)}|${normalise(o.programme)}`)
    .digest("hex")
    .slice(0, 32);
}

export interface DedupeResult {
  fresh: Opportunity[];
  rejections: Rejection[];
}

/** Drop anything already sent in a previous digest, then remember the rest. */
export async function dedupe(opportunities: Opportunity[]): Promise<DedupeResult> {
  const fresh: Opportunity[] = [];
  const rejections: Rejection[] = [];
  const seenThisRun = new Set<string>();
  const collection = store().collection(SEEN);

  for (const o of opportunities) {
    const id = fingerprint(o);

    if (seenThisRun.has(id)) {
      rejections.push({
        stage: "dedupe",
        organisation: o.organisation,
        programme: o.programme,
        sourceUrl: o.sourceUrl,
        reason: "duplicate within this run — the same call from more than one source",
      });
      continue;
    }
    seenThisRun.add(id);

    const existing = await collection.doc(id).get();
    if (existing.exists) {
      rejections.push({
        stage: "dedupe",
        organisation: o.organisation,
        programme: o.programme,
        sourceUrl: o.sourceUrl,
        reason: `already sent on ${existing.get("firstSeen") ?? "a previous run"}`,
      });
      continue;
    }

    fresh.push(o);
  }

  return { fresh, rejections };
}

export async function remember(opportunities: Opportunity[], runId: string): Promise<void> {
  const batch = store().batch();
  for (const o of opportunities) {
    batch.set(store().collection(SEEN).doc(fingerprint(o)), {
      organisation: o.organisation,
      programme: o.programme,
      sourceUrl: o.sourceUrl,
      firstSeen: new Date().toISOString(),
      runId,
    });
  }
  await batch.commit();
}

export type RunStatus = "running" | "sent" | "empty" | "failed";

/**
 * Claim the run before doing any work. Cloud Scheduler retries on a slow
 * response, and without this a retry means the same digest arrives twice.
 * Returns false if this run id is already claimed.
 */
export async function claimRun(runId: string): Promise<boolean> {
  try {
    await store().collection(RUNS).doc(runId).create({
      status: "running" satisfies RunStatus,
      startedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false; // ALREADY_EXISTS — another delivery of the same trigger won.
  }
}

export async function finishRun(
  runId: string,
  status: RunStatus,
  detail: Record<string, unknown>,
): Promise<void> {
  await store()
    .collection(RUNS)
    .doc(runId)
    .set({ status, finishedAt: new Date().toISOString(), ...detail }, { merge: true });
}

export async function saveDigest(runId: string, payload: Record<string, unknown>): Promise<void> {
  await store().collection(DIGESTS).doc(runId).set({ ...payload, runId });
}

export async function recentDigests(limit = 10): Promise<Record<string, unknown>[]> {
  const snapshot = await store()
    .collection(DIGESTS)
    .orderBy("sentAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs.map((d) => d.data());
}
