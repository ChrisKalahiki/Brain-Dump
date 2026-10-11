import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** The hash read commands report for a file and plans carry back in `expect`: the first 16 hex characters of the SHA-256 of its exact bytes. */
export function contentHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** Reads a file once: its text, and the hash of the very bytes that text was decoded from. */
export function readHashed(path: string): { contents: string; hash: string } {
  const bytes = readFileSync(path);
  return { contents: bytes.toString("utf8"), hash: contentHash(bytes) };
}
