# Getting a Session out of Claude web, ChatGPT and Gemini

Research for [#2](https://github.com/ChrisKalahiki/Brain-Dump/issues/2), part of the Brain-Dump v1 map (#1).

**Question.** What ways exist to get a Session (or a selected part of it) out of the Claude web/desktop app, ChatGPT and Gemini so that it can become a Dump in the Vault's Inbox? Claude web has the highest priority.

**Researched:** 2026-10-05. Help-center pages change often. Each citation gives the "last updated" date the page showed when it showed one. "Undated" means the page showed no date.

**Method.** Official help centres and docs were the primary sources. For share links I also sent plain HTTP requests (`curl`, no login, no JavaScript) to real public share URLs found in public GitHub code. Nothing was installed and no accounts were created. I could not log in to any of the three apps, so UI details such as copy buttons are not verified first-hand. They are marked as such.

## TL;DR

1. **No app offers a supported per-Session pull API for a personal account.** All three have a bulk account export: Claude and ChatGPT by email zip, Gemini through Google Takeout. These exports are slow, from minutes to days, and they are all-or-nothing. They suit backfill, not a live Dump.
2. **Share links can't be fetched cheaply for Claude or Gemini.** A Claude `/share/` page is an empty single-page-app (SPA) shell. Its data endpoint sits behind a Cloudflare challenge (HTTP 403). The Gemini share HTML holds no message text. The ChatGPT share HTML *does* contain the messages, but only inside an undocumented serialised script payload.
3. **The routes that work best push content out from inside the Session.** All three apps now accept custom MCP servers that have write tools, with plan and region limits. Claude Desktop's merged Chat and Cowork can also write files directly into a local folder.
4. **For Claude web, the low-friction routes are:** (a) a custom MCP connector exposing a `dump` tool; (b) Claude Desktop writing into the Vault folder; (c) Claude Code with Claude in Chrome reading the open claude.ai tab. Route (c) suits a `dump` command running on the terminal side.

## Routes for Claude web and desktop (priority)

| # | Route | Freshness | Friction | Part of a Session? | Linux | macOS |
|---|---|---|---|---|---|---|
| C1 | Official data export | Minutes or more; whole account | High: email link, 24 h expiry, must parse JSON | No; filter afterwards | Yes (web) | Yes |
| C2 | Share link (public or specific people) | Snapshot when shared; must re-share to update | Medium to high: link not fetchable without a browser | No; whole chat up to the share point | Via browser only | Via browser only |
| C3 | Custom remote MCP connector with a `dump` write tool | Live, in-Session | Medium setup: needs a publicly reachable MCP server; low per use | **Yes**: Claude writes the chosen part | Yes (web) | Yes |
| C4 | Claude Desktop Chat/Cowork writing to a local folder (Vault Inbox) | Live, in-Session | Low per use once a folder is connected | **Yes** | Beta, **Debian/Ubuntu only** | Yes |
| C5 | Local MCP server / desktop extension in Claude Desktop | Live | Medium setup (local server); no public endpoint needed | **Yes** | Beta, Debian/Ubuntu only | Yes |
| C6 | Claude Code + Claude in Chrome reads the open claude.ai tab | Live; whatever is on the page | Low to medium: extension and `--chrome`; per-site permission | **Yes**: the agent selects | Yes (Chrome/Chromium; not WSL) | Yes |
| C7 | First-party write connectors (Google Drive, Notion, Gmail drafts) | Live | Low, but the content lands outside the Vault and needs a second hop | Yes | Yes (web) | Yes |
| C8 | Memory and Projects | Memory: live summary; projects: manual | Low, but lossy (summaries, not the Session) | Partial | Yes | Yes |
| C9 | API | n/a for personal plans | Enterprise-only Compliance API | Yes (per chat) | Yes | Yes |
| C10 | Third-party browser extensions (exporters) | Live | Low per use; trust risk with a session cookie | Varies | Varies | Varies |
| C11 | Copy/paste (message copy, artifact download) | Live | Manual; one message or artifact at a time | Yes | Yes | Yes |

### C1. Official data export

- Free, Pro and Max users export from **Settings > Privacy > Export data** on the web app or in Claude Desktop. Mobile apps can't export. The download link arrives by email, needs a signed-in session, and **expires 24 h after delivery**. Team and Enterprise exports are done by the Primary Owner. ([Export your Claude data](https://support.claude.com/en/articles/9450526-export-your-claude-data), updated 2026-07-08)
- **Format:** Anthropic's article does not document it. Third-party guides report a zip of JSON files (`conversations.json` with a `chat_messages` array, `projects.json`, `users.json`). This is **unverified against a primary source**. Google's import article says the Claude export lets you "select desired date range" ([Import from other AI platforms to Gemini Apps](https://support.google.com/gemini/answer/16868299), undated). Anthropic's page does not mention that, so treat it as uncertain.
- Verdict: good for a one-off **backfill** of past Sessions into Dumps. Too slow and too coarse for an everyday `dump`.

### C2. Share links

- Share creates a **snapshot** of all messages up to the moment of sharing. To pick up newer messages you must unshare and reshare, or "update". Attached files are excluded. MCP tool-call raw data is hidden. Team and Enterprise can share only inside the org. ([Share and unshare chats](https://support.claude.com/en/articles/10593882-share-and-unshare-chats), undated)
- Public links need no account to view and carry `noindex`. They are available on Free, Pro and Max. ([Public links for shared chats](https://support.claude.com/en/articles/16762437-public-links-for-shared-chats), updated 2026-09-04)
- Sharing with specific people by email is the **default**. Those links work only for the invited address, so a script can't fetch them. ([Share a chat with specific people](https://support.claude.com/en/articles/16762496-share-a-chat-with-specific-people), undated)
- **Fetchability (tested 2026-10-05):** `curl` on three real `claude.ai/share/<uuid>` URLs returned an identical 137 KB SPA shell with no message text. WebFetch saw only footer text. The internal JSON endpoint (`/api/chat_snapshots/<uuid>`) returned a **403 Cloudflare "Just a moment…" challenge**. Conclusion: a share link can only be read by a real browser, such as route C6, and the endpoint is undocumented.
- Verdict: weak for Claude. It is whole-chat only, and you would have to switch the default share mode to public just to make a Dump.

### C3. Custom remote MCP connector (push from inside the Session)

- Custom connectors using remote MCP are available on **Free (one connector), Pro, Max, Team and Enterprise**, across Claude web, Cowork and Desktop. The server **must be reachable over the public internet**, because Claude connects from Anthropic's cloud, not from your device. Supported auth: OAuth (including DCR, or your own client credentials) or no sign-in. Tools can be toggled individually, and write tools ask for approval. ([Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp), "updated this week" as of 2026-10-05)
- Fit for Brain-Dump: expose one tool, roughly `dump(title, body, links[], source_url)`. The tool writes a Markdown file into the Vault's `Inbox/`. Claude chooses which part of the Session to send, so it can capture **a selected part** and is **live**. Because the model writes the Dump, it can be shaped to the Dump template: learnings, decisions with rationale, todos, links and papers.
- Cost: you must host something public, such as a Cloudflare Worker or a home server behind a tunnel, plus auth. Obsidian Sync has no public write API, so the server can't write into the Vault directly. It needs a relay. One option: the server stores the Dump (for example in a Git repo or object store), and a small local job on a machine running Obsidian pulls it into `Inbox/`. This adds owned machinery, which ADR 0001 wants kept small.

### C4. Claude Desktop writing into the Vault folder

- Chat and Cowork are merging into one experience. In Desktop you can "give Claude access to a folder on your computer so it can read, organize, and create files there". The rollout is gradual, starting with Pro and Max. ([Claude Cowork and chat are one Claude](https://support.claude.com/en/articles/16761823-claude-cowork-and-chat-are-one-claude), about 2 weeks old as of 2026-10-05)
- Sessions started on web or mobile can read and write connected local folders **only while the desktop app is open** on that computer. This is a beta on Pro, Max, Team and Enterprise. ([Use Claude Cowork on web, desktop, and mobile](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile), "updated this week")
- **Linux caveat:** Claude Desktop for Linux is a **beta for Debian/Ubuntu only** (Ubuntu 22.04+ or Debian 12+). "On distributions that aren't Debian-based, such as Fedora or Arch, run the CLI instead." On Linux, Cowork needs KVM/QEMU. ([Claude Desktop on Linux (beta)](https://code.claude.com/docs/en/desktop-linux), undated) This dev machine runs an Arch-based distro (Omarchy), so **C4 and C5 are not officially available here**, though they would work on a Mac.
- Fit: connect the Vault (or only `Inbox/`) as a folder, then say "dump this". This needs no owned server and the Session isn't left. Open questions: whether plain Chat (not Cowork) can write to the folder for every user yet, and how a sandboxed VM interacts with the Obsidian Sync folder.

### C5. Local MCP server or desktop extension in Claude Desktop

- Desktop extensions (`.mcpb`) and local MCP servers run on the machine. Their tools show up in Desktop chats under "+" > Connectors. The docs mention macOS, Windows and Linux keychains. ([Getting Started with Local MCP Servers on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), "updated over a week ago")
- Fit: the same `dump` tool as C3, but local, so it needs **no public endpoint** and writes straight into `Inbox/`. It works only in Desktop, not in a browser tab, and has the same Linux distro limit as C4.

### C6. Claude Code with Claude in Chrome (pull from the terminal side)

- Claude Code works with the Claude in Chrome extension (v1.0.36+) in Chrome, Edge, or Chromium browsers (Brave, Arc, Vivaldi, Opera). It shares the browser's login state, so it can read any site you are signed in to. It needs a Pro, Max, Team or Enterprise plan and a `/login` sign-in (an API key won't work). It is not supported in WSL. The docs give Linux and macOS native-messaging paths. ([Use Claude Code with Chrome](https://code.claude.com/docs/en/chrome), undated) Claude in Chrome is GA on all paid plans ([Claude in Chrome](https://claude.com/claude-in-chrome)).
- Fit with ADR 0001: `dump` already runs in Claude Code. It could take a claude.ai chat URL, or "the current tab", read the page text, and write the Dump the same way it does for a dev Session. This route is **live**, can capture **part of a Session** (the agent selects), and works on **Linux and macOS** with no owned server. It is the only route that reads a share link reliably, because it renders the page in a real browser.
- Costs: it is fragile against claude.ai UI changes. Long chats may be virtualised or lazy-loaded, which could hide early messages; this is **unverified**. Opening claude.ai needs a per-site permission. Codex has no equivalent documented, so this route would be specific to Claude Code.

### C7. First-party write connectors

- Claude's directory includes connectors that can write, such as Notion `create-pages` ([Notion connector](https://claude.com/connectors/notion)). The Claude Google Drive connector exposes `create_file` and `update_file`, as I saw in this agent's own tool list. I did not check this against a help article.
- Fit: easy to use, but the Dump lands in Drive or Notion rather than the Vault. Getting it into the Vault needs a second hop, for example the `file` command or a sync job pulling from Drive. Obsidian Sync doesn't watch Drive.

### C8. Memory and Projects

- Memory can be viewed in Settings > Memory, or by asking Claude to "Write out your memories of me verbatim". You then copy and paste it. Available on Free, Pro, Max and Team, web and Desktop. ([Import and export your memory](https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude), updated 2026-09-02)
- Chat search lets Claude retrieve past chats by RAG on Pro, Max, Team and Enterprise, across web, Desktop and mobile. ([Use Claude's chat search and memory](https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context), undated)
- Fit: memory is a lossy summary, not a Session, so it is not a capture path. Chat search is useful, though. Combined with C3, C4 or C5, it lets you say "dump what we found about X across this week's chats" from inside Claude. Projects can carry custom instructions that hold the Dump template, which keeps in-app Dumps consistent.

### C9. API

- The Anthropic API does not expose claude.ai chat history. The only first-party API that does is the **Compliance API**, which is **Enterprise-only**. It uses a Compliance Access Key with `GET /v1/compliance/apps/chats` (supports an `updated_at` cursor) and `.../chats/{id}/messages`. ([Retrieve and delete chats, files, and projects](https://platform.claude.com/docs/en/manage-claude/compliance-content-data), undated)
- Fit: none for a personal Pro or Max account.

### C10. Third-party exporter extensions

- These exist, for example "Claude Exporter" on Firefox Add-ons, and generally call claude.ai's undocumented internal API using your session cookie. I did not vet or install any. Risks: a third party gets session-level access to your whole account, and the extension breaks when the internal API changes. Not recommended unless self-written.

### C11. Copy/paste ergonomics

- Not verified first-hand, because I had no login. I could find no Anthropic help article documenting a "copy as Markdown" action for claude.ai messages. Claude Code's "copy as raw Markdown" is CLI-only. Artifacts can be downloaded or published. So a practical manual route is to ask Claude to write the Dump as a Markdown artifact, then download it into `Inbox/`.
- Friction: one message or artifact at a time, manual. Freshness: live.

## ChatGPT

| Route | Freshness | Friction | Part? | Linux / macOS |
|---|---|---|---|---|
| Data export (Settings > Data controls > Export) | Email zip; slow | High; must parse `conversations.json`, whose format changes | No | Web: yes / yes |
| Share link (`chatgpt.com/share/…`) | Snapshot | Medium; **HTML contains the messages** in a serialised script | Whole chat, or a **single response** | Yes / yes |
| Developer mode custom MCP app (write tools) | Live | Medium; MCP server must be public HTTPS or use OpenAI's Secure MCP Tunnel | Yes | Web: yes / yes |
| Compliance API | n/a personal | Enterprise or Edu only | Yes | — |
| Memory and Projects | Summary | Lossy | Partial | — |
| Claude Code + Chrome reading chatgpt.com | Live | Same as C6 | Yes | Yes / yes |

- **Export:** Settings > Data controls > Export. The email link gives a zip containing `conversations.json` (large exports are split into numbered files), and the format "has recently changed". (OpenAI Help: [How do I export my ChatGPT history and data?](https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data) and [Transfer exported conversations](https://help.openai.com/en/articles/9106926-transferring-conversations-from-1-chatgpt-account-to-another-chatgpt-account). Content comes from search-result extracts, because help.openai.com returned 403 to automated fetches. Undated.)
- **Share links:** personal-account links can be viewed by anyone with the link. Business, Enterprise and Edu links are limited to the workspace. Links begin `https://chatgpt.com/share/`. You can share **a single assistant response** rather than the whole chat. ([Sharing conversations and scheduled tasks in ChatGPT](https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq), undated) **Tested 2026-10-05:** a plain `curl` on a real share link returned about 715 KB of HTML. The message text (`"parts":[…]`) is in an inline serialised data stream, so it *is* fetchable without a browser, but parsing it relies on an undocumented format.
- **Developer mode / MCP:** OpenAI announced "full MCP client support for all tools, both read and write" in developer mode on 2025-09-10 ([community announcement](https://community.openai.com/t/mcp-server-tools-now-in-chatgpt-developer-mode/1357233)). Plan coverage for write tools is **unclear**. Search extracts of the current help article ([Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)) say developer mode is on web for Plus, Pro, Business, Enterprise and Edu, but full write support is "rolling out in beta to Business, Enterprise, and Edu". Check against your own plan's Settings. The server must be reachable "through a public HTTPS endpoint or Secure MCP Tunnel" ([Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt), undated).
- **Copy/paste:** not verified first-hand.

## Gemini

| Route | Freshness | Friction | Part? | Linux / macOS |
|---|---|---|---|---|
| Google Takeout (My Activity > Gemini Apps) | Hours to days | High | No | Web: yes / yes |
| Share link (`g.co/gemini/share/…`) | Snapshot | High; HTML has no message text | Whole chat only | Browser only |
| Per-response export: Docs, Gmail draft, Sheets | Live | Low, but lands in Drive or Gmail | **Yes** (one response) | Web: yes / yes |
| Save to Keep (connected app) | Live | Low, but lands in Keep | Yes | Yes / yes |
| Custom MCP apps (write, confirmed by hand) | Live | Medium; **US-only, personal account, 18+, English** | Yes | Web: yes / yes |
| Claude Code + Chrome reading gemini.google.com | Live | Same as C6 | Yes | Yes / yes |

- **Takeout:** select My Activity > Gemini Apps to include "your Gemini chats, generated media, and uploads". Gems are a separate checkbox. Delivered as zip or tgz in "a few hours to a few days". ([Download your Gemini Apps data](https://support.google.com/gemini/answer/16920332?hl=en), undated) The chat file format is not documented on that page.
- **Share:** a public link shares "the entire conversation". It is a snapshot that won't change if you continue the chat. Viewers can continue the chat. Workspace admins can turn sharing off. ([Share your chats from Gemini Apps](https://support.google.com/gemini/answer/13743730), undated) **Tested 2026-10-05:** `curl` on real share links returned about 770 KB of HTML with no message text, because content is loaded client-side.
- **Per-response export:** Export to Docs, Draft in Gmail, Export to Sheets (tables only), plus Colab and Replit for code. ([Export responses from Gemini Apps](https://support.google.com/gemini/answer/14184041?hl=en&co=GENIE.Platform%3DDesktop), undated) Keep: "@Google Keep save this". ([Capture your ideas & notes with Gemini Apps](https://support.google.com/gemini/answer/15230597?hl=en&co=GENIE.Platform%3DDesktop), undated)
- **Custom MCP apps:** you add an MCP server URL in the Gemini web app. Requirements: 18+, **in the US**, a personal Google Account (not work or school), Keep Activity on, English only. "Gemini requires manual confirmation for any write actions." ([Connect & manage custom apps for Gemini Apps](https://support.google.com/gemini/answer/17209137?hl=en&co=GENIE.Platform%3DDesktop), undated) The help page didn't say whether the server must be public. Since Google runs the client, it almost certainly must; this is **an inference**.

## Cross-cutting observations

- **Push beats pull.** All three apps now offer MCP clients with write tools, so one Brain-Dump MCP server with a `dump` tool could serve Claude, ChatGPT and Gemini, subject to plan and region limits. The model inside the Session already has the context, which is the same argument ADR 0001 makes for dev Sessions. The price is a public endpoint plus a relay into the Obsidian Sync Vault.
- **The browser-reader pull route reuses the existing `dump` command.** The pull route with no owned server is Claude Code + Claude in Chrome (C6). It reads whichever chat tab is open, for any of the three apps, using a real browser. Codex would need its own browser tooling.
- **Bulk exports are for backfill only.** All three are emailed or Takeout archives with undocumented, changing formats.
- **Share links are a poor transport.** They work only for ChatGPT, and even there you parse an undocumented format.

## Options for the Claude-web capture path (tentative recommendation)

> **Tentative recommendation (not a decision).** Start with **C6 (Claude Code + Claude in Chrome)**. It needs no new infrastructure, works on this Arch machine and on macOS, and is an extension of `dump` (for example, `dump <claude.ai URL>` or "dump the open chat tab"). Add **C3 (remote MCP `dump` tool)** later if dumping from *inside* Claude web, or from the phone, proves worth hosting a public endpoint. That decision depends on the relay design into Obsidian Sync. On a Mac, or if Desktop reaches Arch, **C4 (Desktop writes into `Inbox/`)** is the lowest-friction in-app option and needs no server at all. Use **C1 (export)** only for a one-off backfill.

| Option | Pros | Cons |
|---|---|---|
| C6 browser reader | No server; Linux and macOS; reuses `dump`; also covers ChatGPT and Gemini | Leaves the app (switch to terminal); fragile to DOM changes; Claude Code only |
| C3 remote MCP | Dump from inside the Session; one server for all three apps; works on mobile | Public endpoint and auth; relay into Obsidian Sync; most owned machinery |
| C4 Desktop folder write | Zero infrastructure; writes straight to `Inbox/` | Desktop on Linux is Debian-only beta; rollout gradual; Desktop must be open |
| C5 local MCP | No public endpoint; deterministic file format | Desktop only (same Linux limit) |
| C11 artifact download | Works today, no setup | Manual every time |

## Open questions and uncertainty

- The exact Claude export format and the "date range" option. Anthropic doesn't document them.
- Whether Claude in Chrome's page reader returns the *full* text of very long claude.ai chats (lazy rendering). This needs a hands-on test.
- Whether plain Claude Chat (not only Cowork) can write to a connected folder for this account yet, given the gradual rollout.
- ChatGPT: whether write-capable MCP tools are available on the user's personal plan today. The sources conflict.
- How a remote MCP server would deliver files into an Obsidian Sync Vault. This is a separate design question.
- Copy-as-Markdown behaviour in the claude.ai, ChatGPT and Gemini UIs, which I couldn't verify without a login.
