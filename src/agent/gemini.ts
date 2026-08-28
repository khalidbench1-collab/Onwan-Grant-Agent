import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

let client: GoogleGenAI | null = null;

/**
 * One shared Vertex AI client. Credentials come from the Cloud Run service
 * account at runtime and from `gcloud auth application-default login` locally —
 * there is no API key anywhere in this repository.
 */
export function gemini(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({
      vertexai: true,
      project: config.projectId,
      location: config.vertexLocation,
    });
  }
  return client;
}

/** Pull the plain text out of a response, tolerating an empty candidate list. */
export function textOf(response: { text?: string | undefined }): string {
  return (response.text ?? "").trim();
}

/**
 * Models wrap JSON in ```json fences often enough that stripping them is
 * cheaper than retrying the call.
 */
export function parseJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}
