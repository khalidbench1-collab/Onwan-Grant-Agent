import { requireRunConfig } from "../config.js";

/**
 * Resend over the Gmail API, for one specific reason: the Gmail API needs a
 * sensitive OAuth scope and therefore a Google verification review. This
 * service touches no user data and has no consent screen, and sending mail
 * through a third party is what keeps it that way.
 *
 * Plain fetch — the SDK adds a dependency to wrap one POST.
 */
export async function sendDigest(subject: string, html: string): Promise<string> {
  const { resendApiKey, digestFrom, digestTo } = requireRunConfig();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: digestFrom,
      to: [digestTo],
      subject,
      html,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) {
    throw new Error(`Resend rejected the digest (${response.status}): ${body.message ?? "no detail"}`);
  }
  return body.id ?? "unknown";
}
