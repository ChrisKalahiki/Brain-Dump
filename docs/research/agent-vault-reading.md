# How do agents read Obsidian vaults today?

Research for [#36](https://github.com/ChrisKalahiki/Brain-Dump/issues/36), part of #29. Feeds #37 (skill vs direct read); this file does not decide that.
Researched 2026-10-09. Every claim cites a URL. "UNVERIFIED" marks claims not confirmed against a primary source.

## Question

Survey prior art for agents reading an Obsidian vault: raw grep/glob over the directory, Obsidian MCP servers, structured-index or graph tools, and Claude Code / Codex community skills. For each: strengths, failure modes, setup cost, whether Obsidian must be running, and permission implications for an agent working in another repo directory.

## 1. Raw file tools over the vault directory (grep / glob / read)

- **What it is.** The agent treats the vault as a folder of Markdown. One community write-up describes Claude Code finding "related notes with ripgrep" and reading project overview/task files first, guided by an `AGENTS.md` ([okhlopkov.com](https://okhlopkov.com/second-brain-obsidian-claude-code/)). A community skill states the premise as "a vault is essentially a codebase of markdown files" (relayed via the [agentskills.so listing](https://agentskills.so/skills/julianobarbosa-claude-code-skills-obsidian-second-brain); secondary source, UNVERIFIED against the skill repo).
- **Setup cost.** None beyond access to the directory. No plugin, no running app.
- **Obsidian running?** No.
- **Permissions for an agent in another repo.** Claude Code's file tools are scoped to the launch directory; extend with `--add-dir`, `/add-dir`, or `additionalDirectories` in settings. Reads in additional directories need no prompt; edits follow the permission mode. `permissions.blockReadsOutsideWorkingDirectories` can fence reads ([Claude Code permissions: Working directories](https://code.claude.com/docs/en/permissions#working-directories)). File reads and Grep are classed read-only and prompt-free inside those directories, while Bash needs approval except for a built-in read-only set ([same page, permission table](https://code.claude.com/docs/en/permissions)).
- **Fails at.**
  - Wikilinks: Obsidian links are `[[Note]]`, optionally with `#heading`, `#^block`, aliases and `|display text`; folder paths are root-relative ([Obsidian: Internal links](https://obsidian.md/help/links)). Resolving `[[X]]` to a file, finding backlinks, or honouring aliases is not something grep does. The help page does not document duplicate-name resolution, so how a naive resolver should behave is UNVERIFIED. Block links "won't work outside Obsidian" (same page).
  - Wording mismatch: plain text search is lexical, no semantic matching (inferred from the nature of grep; QMD below is the contrasting case).
  - Context bloat: the same author lists "agents have context limits too" among lessons and warns against complex folder structure the agent must guess at ([okhlopkov.com](https://okhlopkov.com/second-brain-obsidian-claude-code/)).
  - Frontmatter/tags: text-only; the agent must parse YAML itself. No primary source evaluated this specifically; UNVERIFIED.

## 2. Obsidian MCP servers

### 2a. Via the Local REST API plugin (Obsidian must be running)

- **Local REST API plugin** ([coddingtonbear/obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api)): runs inside Obsidian. Read/create/update/delete files; `GET /tags/` with counts; `POST /search/simple/` (Obsidian's fuzzy search, filenames + snippets); `POST /search/` with a JsonLogic expression over frontmatter, tags, path and content; PATCH to a heading, block reference or frontmatter key; frontmatter readable at `/vault/<path>/frontmatter/<key>`. Bearer-token auth, HTTPS on `127.0.0.1:27124` with a local CA (optional HTTP on 27123), `.obsidian` blocked with 403. Newer versions ship a built-in MCP server at `/mcp/` (Streamable HTTP, about 20 tools such as `vault_read`, `search_query`, `search_simple`, `tag_list`, `command_execute`) with setup for Claude Code, Claude Desktop (via `mcp-remote`) and Cursor. The README does not mention Dataview.
- **MarkusPfundstein/mcp-obsidian** ([repo](https://github.com/MarkusPfundstein/mcp-obsidian)): Python 3.11+, tools `list_files_in_vault`, `list_files_in_dir`, `get_file_contents`, `search`, `patch_content`, `append_content`, `delete_file`. Needs the REST plugin running plus `OBSIDIAN_API_KEY`/`HOST`/`PORT`. Pinned to `mcp` 1.x; `mcp>=2.0` fails at import. No backlink or tag tool listed.
- **AlexW00/obsidian-rest-mcp** ([repo](https://github.com/AlexW00/obsidian-rest-mcp)): Docker; generates tools from the plugin's OpenAPI spec so it tracks the API. Small project (10 stars, 13 commits at fetch time). Works only while the plugin is reachable.
- **jacksteamdev/obsidian-mcp-tools** ([repo](https://github.com/jacksteamdev/obsidian-mcp-tools)): semantic search via the Smart Connections plugin, templates via Templater, requires Local REST API and Claude Desktop. **Archived 2026-05-13, read-only.** The README says the server never gives the AI direct file access.
- **Setup cost.** Install and enable a community plugin, copy an API key, register an MCP server. Obsidian must be open with the plugin enabled. The permission surface is a localhost HTTP endpoint plus a bearer token; the agent's directory scoping does not apply because access goes through the app (inference from the architecture above).
- **Fails at.** Availability (app must be running); API surface limited to what the plugin exposes. Backlink/link-graph queries are not in the listed REST or MCP tools (absence in READMEs is not proof; `command_execute` might reach them, UNVERIFIED).

### 2b. Filesystem-based (Obsidian need not run)

- **StevenStavrakis/obsidian-mcp** ([repo](https://github.com/StevenStavrakis/obsidian-mcp)): Node 22+, reads/writes Markdown directly, no Obsidian needed. Vaults allowlisted at startup via `--vault id=/absolute/path` (up to ten; each needs `.obsidian`). Tools include `obsidian_read_note` (paginated, with SHA-256 etag), `obsidian_search_vault` (content, filenames or tags, cursor pagination), tag management, and `obsidian_move_note` which updates unambiguous backlinks and leaves ambiguous ones unchanged. Text responses capped at 25,000 characters; symlinks and `.obsidian`/`.git` blocked; mutations journaled and rolled back on failure; delete goes to trash. The README warns clients can invoke destructive tools. It lists no backlink-query or frontmatter-query tool.
- **Permissions.** The `--vault` path is the authorization; the server process needs read and write on that path. It is a separate process from the agent's working-directory rules (inference).

## 3. Structured index / link-graph / frontmatter-query tools

- **Official Obsidian CLI** (installer 1.12.7+, [docs](https://obsidian.md/help/cli); first introduced in 1.12.4 per the [changelog](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/)): connects to the running app; "the first command you run launches Obsidian" if it is not running. Enable under Settings, General, "Command line interface", then restart the terminal. Commands: `search query=... [path= limit= total case format=text|json]`, `search:context` (grep-style `path:line: text`), `backlinks file=|path=` (json/tsv/csv), `links`, `unresolved`, `tags counts`, `properties` (yaml/json/tsv), `read`, `tasks`. Vault selected by cwd if inside a vault, else the active vault, or `vault=<name>` first. `file=` resolves like a wikilink; `path=` is root-relative ([kepano obsidian-cli SKILL](https://raw.githubusercontent.com/kepano/obsidian-skills/main/skills/obsidian-cli/SKILL.md)). Index-backed, so backlinks, unresolved links and properties come from Obsidian itself. Costs: app must be running; the default vault is the active one, which can differ from the intended one unless `vault=` is passed. Hangs when Obsidian is not running are reported by third parties ([community skill listing](https://skills.cat/skills/vadirn/nix/obsidian-cli); UNVERIFIED).
- **NotesMD CLI** ([Yakitrak/notesmd-cli](https://github.com/Yakitrak/notesmd-cli), formerly "Obsidian CLI"): Go; works without Obsidian running; `search` (fuzzy note names), `search-content "term"` (`--no-interactive`, `--format json`, paging); vaults registered via Obsidian's config or `add-vault`; commands act on the vault directory, not the cwd. README documents no backlinks command; `move` updates links.
- **Dataview** ([blacksmithgu/obsidian-dataview](https://github.com/blacksmithgu/obsidian-dataview)): query frontmatter and inline `Key:: Value` fields with DQL or DataviewJS. It is an Obsidian plugin; the README does not document running outside Obsidian (UNVERIFIED either way). The author calls it a "hobby project"; 638 open issues at fetch time.
- **QMD** ([tobi/qmd](https://github.com/tobi/qmd)): local search engine over Markdown folders (default glob `**/*.md`) with YAML frontmatter filtering. Modes: `search` (BM25), `vsearch` (vector), `query` (hybrid with LLM expansion and reranking). MCP server over stdio or HTTP (`query`, `get`, `multi_get`, `status`, `metadata`), plus a Claude Code plugin. Needs Node 22+ or Bun and downloads about 2 GB of local models on first use (about 300 MB, 640 MB, 1.1 GB). Obsidian not required. README does not mention wikilinks, so link/backlink handling is UNVERIFIED. It directly addresses wording mismatch.
- **Smart Connections** (semantic search plugin used by obsidian-mcp-tools): not evaluated from a primary source; only mentioned in the [obsidian-mcp-tools README](https://github.com/jacksteamdev/obsidian-mcp-tools).

## 4. Claude Code / Codex skills and community write-ups

- **kepano/obsidian-skills** ([repo](https://github.com/kepano/obsidian-skills)): skills `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `obsidian-cli`, `defuddle`, `knap`. Install for Claude Code via `/plugin marketplace add kepano/obsidian-skills`, copy to `~/.codex/skills` for Codex, or place under the vault's `.claude` folder. The README does not describe vault searching beyond the `obsidian-cli` skill, which wraps the official CLI and so inherits "Obsidian must be open".
- **julianobarbosa/claude-code-skills `obsidian-second-brain`**: pattern ladder from direct file access to a vault-root CLAUDE.md manifest; low adoption (49 installs, 6 stars per a [Skillselion listing](https://skillselion.com/skills/julianobarbosa/claude-code-skills/obsidian-claude-integration); relayed via search, UNVERIFIED against the repo).
- **okhlopkov.com write-up** ([link](https://okhlopkov.com/second-brain-obsidian-claude-code/)): vault of Markdown plus `AGENTS.md` folder policy plus ripgrep; a separate retrieval layer (GBrain) for distilled material; "treating search as the product" named as a mistake; raw human text kept unedited. A single practitioner's account.
- Other blog posts surfaced (mindstudio.ai, pasqualepillitteri.it) were not read; UNVERIFIED and secondary.

## Comparison (neutral)

| Approach | Strengths | Known failure points | Setup cost | Obsidian must run? | Agent-in-other-repo permission note |
|---|---|---|---|---|---|
| Raw grep/glob/read | Zero setup; exact text; structure visible via paths | No wikilink or alias resolution; no backlinks; lexical only; agent parses frontmatter itself | None | No | Add vault via `--add-dir` / `additionalDirectories`; reads then prompt-free |
| Local REST API plugin + MCP (built-in, MarkusPfundstein, AlexW00) | Obsidian's own search; tags; JsonLogic over frontmatter; PATCH to heading/frontmatter | App must run; no backlink tool in listed READMEs; third-party servers pinned or small | Plugin, API key, MCP registration | Yes | Localhost HTTPS + bearer token; outside directory allowlist |
| Filesystem MCP (StevenStavrakis) | Works offline; paginated reads; tag search; link-aware moves | No link-graph query tool listed; 25k char cap; Node 22+ | Register server with `--vault` path | No | Vault allowlist by path; needs read/write |
| Official Obsidian CLI | Index-backed backlinks, links, unresolved, properties, tags, tasks; JSON output | App must run; default vault may be wrong one; 1.12.7+ | Enable CLI, register, restart terminal | Yes (launches it if closed) | Shell command; Bash permission rules apply |
| NotesMD CLI | No app needed; JSON content search | No backlinks documented | Install binary, register vault | No | Shell command; vault by registered path |
| Dataview | Frontmatter/inline-field queries | In-app plugin; outside use undocumented | Plugin | Appears so (UNVERIFIED) | n/a |
| QMD | BM25 + vector + rerank; frontmatter filters; MCP and Claude plugin | Wikilinks undocumented; about 2 GB models; index to maintain | Install, index collection, download models | No | Reads the indexed folder; models cached in `~/.cache/qmd/models/` |
| Community skills (kepano, others) | Teach format/CLI conventions; installable for Claude Code and Codex | Mostly wrap CLI or file access, so inherit those limits; adoption varies | Plugin/skill install | Depends on wrapped tool | Depends on wrapped tool |

## Open points not settled by primary sources

- How shortest-path wikilink resolution and duplicate names behave (Obsidian help does not specify).
- Whether Local REST API or its MCP exposes backlinks (e.g. via `command_execute`).
- Dataview use outside Obsidian.
- Context-size behavior of raw grep over large vaults (no benchmark found).
