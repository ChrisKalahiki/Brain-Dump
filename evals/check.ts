import { EVALS, staleEvals } from "./eval.ts";

// `bun run eval:check`: fails while any eval's inputs have changed since its recorded pass. It stays out of `bun test` so a commit mid-ticket isn't
// blocked by an eval not yet rerun; CI runs it on every PR.

const stale = staleEvals(EVALS);
for (const line of stale) console.error(line);
if (stale.length === 0) console.log(`${EVALS.length} evals passed against their current inputs`);
process.exitCode = stale.length === 0 ? 0 : 1;
