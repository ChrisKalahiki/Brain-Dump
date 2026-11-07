/** Todoist IDs are opaque strings, never numbers or note names. */
export function isTodoistId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

export function todoistTaskUrl(task: string): string {
  const encoded = encodeURIComponent(task).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `https://app.todoist.com/app/task/${encoded}`;
}
