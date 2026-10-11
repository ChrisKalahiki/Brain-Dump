import { createHash } from "node:crypto";

/** The hash read commands report for a file and plans carry back in `expect`: the first 16 hex characters of the SHA-256 of its exact bytes. */
export function contentHash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}
