export class BrainDumpError extends Error {}

export class UsageError extends BrainDumpError {}

export class DumpNotWrittenError extends BrainDumpError {
  constructor(
    message: string,
    readonly dump: string,
  ) {
    super(message);
  }
}

export function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

export function describeFsError(error: unknown): string {
  switch (errnoCode(error)) {
    case "EACCES":
    case "EPERM":
      return "permission denied";
    case "EROFS":
      return "read-only file system";
    case "ENOSPC":
      return "no space left";
    default:
      return error instanceof Error ? error.message : String(error);
  }
}
