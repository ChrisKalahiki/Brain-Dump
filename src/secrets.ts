// Common credential shapes; `write-dump` refuses any Dump body that matches one, swept or manual.

const SECRET_PATTERNS: [kind: string, pattern: RegExp][] = [
  ["an OpenAI or Anthropic key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["a GitHub token", /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ["an AWS access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["an AWS secret key", /\baws_secret_access_key\s*[=:]\s*\S/i],
  ["a PEM block", /-----BEGIN [A-Z0-9 ]+-----/],
  ["a password", /\bpassword\s*=\s*\S/i],
];

/** The first line (1-based) holding a secret, and what kind it looks like; never the secret itself. */
export function findSecret(text: string): { line: number; kind: string } | undefined {
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = SECRET_PATTERNS.find(([, pattern]) => pattern.test(line));
    if (match) return { line: index + 1, kind: match[0] };
  }
  return undefined;
}
