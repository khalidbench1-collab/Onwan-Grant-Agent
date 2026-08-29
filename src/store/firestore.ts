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

/*
 * Identity is the funder plus the programme name — NOT the URL.
 *
 * The same fellowship appears on the funder's site, on two aggregators and in a
 * newsletter, each with a different URL and tracking parameters. Hashing URLs
 * would dedupe nothing in exactly the case that matters.
 *
 * The first version hashed the normalised name as an ordered string, which was
 * still too brittle. Two live runs a day apart produced, for the same three
 * calls: a year appended ("Fellowship Lokale Recherche" → "… 2026/2027"), a
 * parenthesised list reordered, and "e.V." moved to the other side of "(IJP)".
 * All three hashed differently and all three were re-sent.
 *
 * So identity is now a SET of tokens, not a sequence. Anything derived from
 * generated text has to be compared that way, because the generator is free to
 * reorder it and will.
 */

/** Legal forms and function words that carry no identity. */
const NOISE = new Set([
  "e", "v", "ev", "ev.", "gmbh", "ggmbh", "gug", "inc", "llc", "ltd",
  "the", "a", "an", "of", "for", "and", "in", "on", "to",
  "der", "die", "das", "des", "den", "und", "fur", "von", "im", "zur", "zum",
]);

/**
 * Words that identify a name, lowercased and stripped of accents and
 * punctuation, with years and legal forms removed.
 *
 * Deliberately NOT stemmed: "Rainforest Reporting Grant" and "Global Reporting
 * Grants" are different programmes from the same funder, and folding the plural
 * would merge them and silently drop a real call.
 */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents BEFORE punctuation, or "ä" splits a word in two
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE.has(t) && !/^(19|20)\d{2}$/.test(t));
}

function hash(parts: string[]): string {
  return createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, 32);
}

/** The funder alone, order-independent. Used to narrow the near-match search. */
export function orgKey(organisation: string): string {
  return hash([...new Set(tokens(organisation))].sort());
}

/** The programme's identifying words, for comparing two names that differ. */
export function programmeTokens(programme: string): string[] {
  return [...new Set(tokens(programme))].sort();
}

export function fingerprint(o: Pick<Opportunity, "organisation" | "programme">): string {
  return hash([...new Set([...tokens(o.organisation), ...tokens(o.programme)])].sort());
}

/** Shared words as a fraction of the SHORTER name. */
const SAME_PROGRAMME_OVERLAP = 0.6;

/**
 * Whether two programme names from the same funder are the same call.
 *
 * Containment against the shorter name rather than Jaccard, because the real
 * failure is one run writing a longer version of the other's name. For
 * "Deutsch-Nordeuropäisches Journalistenprogramm" vs "… Programm", Jaccard is
 * 0.5 and containment is 0.67 — and a Jaccard threshold low enough to catch it
 * would start merging genuinely different calls.
 *
 * Both names must carry at least two identifying words. One shared word is a
 * coincidence, not an identity.
 */
export function looksLikeSameProgramme(a: string[], b: string[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const other = new Set(b);
  const shared = a.filter((t) => other.has(t)).length;
  return shared / Math.min(a.length, b.length) >= SAME_PROGRAMME_OVERLAP;
}

export interface DedupeResult {
  fresh: Opportunity[];
  rejections: Rejection[];
}

/**
 * Drop anything already sent in a previous digest.
 *
 * Two passes, because one is not enough. The exact fingerprint catches a call
 * whose name came back token-for-token identical. When that misses, we ask for
 * everything already seen from the SAME funder and compare programme names for
 * overlap — that is what catches a name the model shortened or padded between
 * runs. Narrowing by funder first keeps this to one small query per miss
 * instead of a scan.
 */
export async function dedupe(opportunities: Opportunity[]): Promise<DedupeResult> {
  const fresh: Opportunity[] = [];
  const rejections: Rejection[] = [];
  const collection = store().collection(SEEN);

  /** Kept so far in THIS run — the same call can arrive from two aggregators. */
  const thisRun: { org: string; programme: string[] }[] = [];

  const drop = (o: Opportunity, reason: string) =>
    rejections.push({
      stage: "dedupe",
      organisation: o.organisation,
      programme: o.programme,
      sourceUrl: o.sourceUrl,
      reason,
    });

  for (const o of opportunities) {
    const id = fingerprint(o);
    const org = orgKey(o.organisation);
    const programme = programmeTokens(o.programme);

    const twiceThisRun = thisRun.some(
      (p) => p.org === org && looksLikeSameProgramme(programme, p.programme),
    );
    if (twiceThisRun) {
      drop(o, "duplicate within this run — the same call from more than one source");
      continue;
    }

    const existing = await collection.doc(id).get();
    if (existing.exists) {
      drop(o, `already sent on ${existing.get("firstSeen") ?? "a previous run"}`);
      continue;
    }

    // Same funder, differently worded programme name.
    const siblings = await collection.where("orgKey", "==", org).get();
    const match = siblings.docs.find((d) =>
      looksLikeSameProgramme(programme, (d.get("programmeTokens") as string[] | undefined) ?? []),
    );
    if (match) {
      drop(
        o,
        `already sent on ${match.get("firstSeen") ?? "a previous run"} as "${match.get("programme")}"`,
      );
      continue;
    }

    thisRun.push({ org, programme });
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
      // Stored, not recomputed on read: a later change to tokenising must not
      // silently reinterpret what earlier runs meant by "seen".
      orgKey: orgKey(o.organisation),
      programmeTokens: programmeTokens(o.programme),
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
