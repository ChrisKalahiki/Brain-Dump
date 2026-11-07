/** A subprocess-only transport double: never connects to Todoist. */
globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const request = new Request(input instanceof Request ? input.url : input.toString(), init);
  const url = new URL(request.url);
  if (url.origin !== "https://api.todoist.com" || url.pathname !== "/api/v1/tasks/filter" || request.method !== "GET" || url.searchParams.get("query") !== "assigned to: me") {
    throw new Error("unexpected Todoist request");
  }
  if (request.headers.get("Authorization") !== "Bearer synthetic-token") return new Response("denied", { status: 401 });
  return Response.json({
    results: ["task-1", "task-2"].map((id) => ({ id, content: `Review ${id}`, project_id: "team-project", responsible_uid: "me", due: null })),
    next_cursor: null,
  });
}, { preconnect: fetch.preconnect });
