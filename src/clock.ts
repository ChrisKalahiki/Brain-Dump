import { UsageError } from "./errors.ts";

const NOW_VARIABLE = "BRAIN_DUMP_NOW";

/** The current time, or the time in `BRAIN_DUMP_NOW` when it is set, so tests control every age, window and Run id. */
export function now(): Date {
  const override = process.env[NOW_VARIABLE];
  if (override === undefined) return new Date();
  const at = new Date(override);
  if (Number.isNaN(at.getTime())) throw new UsageError(`${NOW_VARIABLE} "${override}" is not a date and time`);
  return at;
}
