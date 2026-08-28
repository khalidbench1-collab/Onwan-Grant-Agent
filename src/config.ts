/**
 * Configuration is read once at module load and split into two tiers.
 *
 * `config` holds what the process needs merely to *start* and answer a health
 * check. If any of it is missing the container should still boot, because a
 * container that crash-loops on Cloud Run gives you no logs to debug with.
 *
 * `requireRunConfig()` holds what a pipeline run needs, and it throws loudly.
 * A run that quietly skips sending because a key was absent is worse than a
 * run that fails with a named reason.
 */

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  port: Number(env("PORT", "8080")),
  projectId: env("GOOGLE_CLOUD_PROJECT", "onwan-production"),
  vertexLocation: env("VERTEX_LOCATION", "global"),
  model: env("GEMINI_MODEL", "gemini-3.6-flash"),
  runKey: env("RUN_KEY"),
} as const;

export interface RunConfig {
  resendApiKey: string;
  digestFrom: string;
  digestTo: string;
}

export function requireRunConfig(): RunConfig {
  const missing: string[] = [];
  const resendApiKey = env("RESEND_API_KEY");
  const digestTo = env("DIGEST_TO");
  const digestFrom = env("DIGEST_FROM", "Onwan Grants <onboarding@resend.dev>");

  if (!resendApiKey) missing.push("RESEND_API_KEY");
  if (!digestTo) missing.push("DIGEST_TO");

  if (missing.length > 0) {
    throw new Error(
      `Cannot run the pipeline — missing configuration: ${missing.join(", ")}. ` +
        `Set these in Secret Manager and mount them on the Cloud Run service.`,
    );
  }

  return { resendApiKey, digestFrom, digestTo };
}
