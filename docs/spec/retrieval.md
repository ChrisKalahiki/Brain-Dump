# Brain-Dump retrieval spec

Terms are defined in [`GLOSSARY.md`](../../GLOSSARY.md). Tracked as [#129](https://github.com/ChrisKalahiki/Brain-Dump/issues/129), with tickets [#130](https://github.com/ChrisKalahiki/Brain-Dump/issues/130) to [#135](https://github.com/ChrisKalahiki/Brain-Dump/issues/135). Each ticket links to its heading under Implementation Decisions.

## Problem Statement

Recall can find what Brain-Dump wrote, but not what the user wrote. Today it returns Items only: bullets with a `From [[dump]]` backlink, a `Why:` line or `#todo`. Almost everything in the Vault is hand-written text under headings, and none of it is reachable except by `show` on a note the agent already knows to ask for.

- **Most of the Vault is invisible to Recall.** In the user's Vault, `Research/Main Notes` holds 78 notes with about 3,000 bullets and 1,100 headings; about 40 Items there came from Filing. A Session asking "what have I worked out about evaluation methods?" gets nothing back unless the answer happens to be a filed Item.
- **The structure that would find it is already there and unused.** Main Notes average about 15 headings per note. Headings name what lies under them, and the Vault's titles and headings together come to about 42k characters outside Weekly Notes: small enough for an agent to read in one go.
- **Term search ranks crudely.** `recall <terms…>` counts distinct terms per Item, so a term that appears in every note weighs as much as a rare name.
- **Filing chooses notes from a flat list.** `file` matches an Item to a note by title, folder and tags from `list-notes`, without seeing what each note covers.
- **Nothing measures retrieval.** No eval covers Recall, so a prompt change that sends agents to the wrong note passes unnoticed.

[STAIR](https://arxiv.org/abs/2609.03874) (Kumar et al., 2026) shows the way through: given a document's own heading structure and a question, a model that names the heading section holding the answer beats fixed-length passages, dense embeddings and BM25, and restricting its output to headings that exist all but removes invented answers. STAIR fine-tunes a model per document; Brain-Dump can't, because the Vault changes with every Filing and ADR 0007 rules out an index. The part that carries over is the unit and the constraint: Sections as the thing retrieved, and the helper refusing any Section that doesn't exist.

## Solution

Recall reaches Sections of Curated Notes as well as Items, still in context, with no index and no training. Six tickets, in one chain plus a branch:

- **01 Sections → 02 Outline → 04 Benchmark → 05 Recall skill and eval**
- **01 Sections → 03 BM25 Sections**, which 04 also needs
- **02 Outline → 06 Filing reads the Outline**

The helper gains `outline` and Section-level `show`, and `recall <terms…>` returns ranked Sections beside Items. A local benchmark against the user's real Vault picks how the `recall` skill uses them before the skill is rewritten, and a committed eval then holds the skill to it.

From the user's side, Filing writes exactly as today: Items still go at the end of their note. The Filing Plan may name the Section that made a match.

## User Stories

1. As an agent, I want to look up what the user wrote by hand, not only what Brain-Dump filed, so that settled thinking isn't redone.
2. As an agent, I want `brain-dump outline` to list Curated Notes with their nested Section names, so that I can see what the Vault covers before reading any of it.
3. As an agent, I want each Outline entry to give the Section's size in bullets and lines, so that I can tell a stub from a long Section before reading it.
4. As an agent, I want each note in the Outline to carry its tags, whether it has a Digest, its filed-Item count and its `hash`, so that one read serves Recall and Filing.
5. As an agent, I want `outline <folder>` and `outline "[[Note]]"`, so that I can narrow the Outline when the whole is more than I need.
6. As the Vault owner, I want Weekly Notes left out of the Outline, so that template words like `To-Do:` don't crowd out Section names that carry meaning.
7. As an agent, I want the Outline capped at about 12k tokens, with a clear line saying how to narrow it when it is cut, so that one call can't flood my context.
8. As an agent, I want `brain-dump show "[[Note#Section]]"` to return just that Section with its nested Sections, so that I read only what answers the question.
9. As an agent, I want Section names written as Obsidian heading links, nested as `[[Note#Parent#Child]]`, so that every name I cite also opens in Obsidian.
10. As an agent, I want a name matching two Sections refused with their line numbers, so that I never read the wrong one silently.
11. As an agent, I want an unknown Section refused with the nearest real Section names, or the nearest note titles when the note is wrong, so that I can correct course in one step.
12. As an agent, I want the text before a note's first heading to be its own Section, and a note with no headings to be one Section, so that every line of a note belongs to exactly one Section.
13. As an agent, I want `show <note> --filed` to return a note's filed Items and Digests, wherever they sit in the note, so that what Filing appended isn't attributed to whichever heading happens to come last.
14. As an agent, I want `recall <terms…>` to also return matching Sections ranked by BM25, so that a rare name outranks a common word.
15. As an agent, I want Weekly Notes included in term search, so that meeting notes stay findable though they are not in the Outline.
16. As an agent, I want Item results unchanged in shape, so that the pointer hook and existing callers keep working.
17. As the Vault owner, I want nothing new stored to make this work, so that two machines never disagree about an index.
18. As the Vault owner, I want everything this spec reads limited to the write allowlist, as Recall is today, so that private folders stay out of model context.
19. As the Vault owner, I want a local benchmark that scores retrieval on my real Vault, so that I know how it performs on my notes, not only on fixtures.
20. As the Vault owner, I want the benchmark to write nothing in the Vault or the repo, so that my notes never leave my machine except to the model provider, and never land in a public repo.
21. As the Vault owner, I want the benchmark's questions to come from my filed Items, from paraphrased questions a model writes per Section, and from questions I write, so that it measures more than word overlap.
22. As a developer, I want the benchmark to compare BM25 alone, the full Outline, drilling down from notes to Sections, and the Outline with BM25's top results beside it, so that the `recall` skill's default is measured, not guessed.
23. As a developer, I want each candidate scored on Recall@1 and Recall@3 and on how often it names a Section that doesn't exist, so that the comparison matches STAIR's.
24. As an agent, I want the `recall` skill to try my project's Items, then terms, then the Outline, and read at most 3 Sections, so that I answer from the Vault without reading all of it.
25. As the Vault owner, I want every answer from Recall to cite `[[Note#Section]]`, so that I can check it in Obsidian.
26. As a developer, I want a committed `recall` eval on a synthetic Vault, so that a prompt change that sends agents to the wrong Section fails before it ships.
27. As the file skill, I want to read the Outline once per run in place of `list-notes`, so that I match Items to notes by what they cover, not only by title.
28. As the Vault owner, I want the Filing Plan to name the Section that made a match while the Item still goes at the note's end, so that I see why without Filing changing where it writes.

## Implementation Decisions

### 01 Sections

- A new pure module reads a note's lines into Sections. A heading of any level opens a Section that runs until the next heading of the same or a higher level; Sections nest by level.
- Lines before a note's first heading form a Section named for the note (`[[Note]]`). A note with no headings is that one Section.
- A note's **filed lines** (each backlinked Item bullet with its `Why:` and `From` lines, and each Digest callout with its `^digest-…` line) belong to no Section. Filed lines are found with the curated-note module's existing parsers, so the two can't disagree.
- A Section's **own text** is its heading line and the lines up to its first nested Section, less filed lines. Its **size** is its own bullets and lines plus those of its nested Sections.
- A Section's name is its heading path: `[[Note#Parent#Child]]`. Names are written as Obsidian writes heading links, and match as Obsidian matches them: ignoring case, surrounding whitespace, and punctuation (see "Verify during the build").
- A name may give only the deepest heading (`[[Note#Child]]`) when that is unique in the note. When it matches more than one Section, it is refused: `[[Note#Notes]] matches lines 12 and 40 of Note; pass its full path, e.g. [[Note#Week 1#Notes]]`.
- An unknown name is refused with up to 5 nearest Section names in that note, or up to 5 nearest note titles when the note itself doesn't resolve. Nearness is word overlap, then edit distance.
- `show "[[Note#Section]]"` returns `{note, section, hash, text, truncated}`: the Section's lines with its nested Sections, without filed lines. `hash` covers the whole note, as today, for a plan's `expect`. The 60k cap applies; `--full` lifts it.
- `show <note> --filed` returns `{note, hash, text, truncated}` with the note's filed lines in order. `--filed` and a Section name can't be combined.
- `show <note>` without a Section behaves as today.
- Sections are scoped as `show` is today: the write allowlist (ADR 0007, ADR 0012).

### 02 Outline

- `brain-dump outline [scope]` prints the Outline as text: one line per note, then one indented line per Section, nested by level.
- A note line carries its Vault path, tags, `digest` when it has one, its filed-Item count and its `hash`. A Section line carries its heading as written and `[bullets/lines]`. A first line gives the legend. Example:

  ```
  # Outline · note: path · tags · digest · filed Items · hash · Section: name [bullets/lines]
  Research/Main Notes/SQLite.md · Databases · digest · 13 filed · 1a2b3c4d5e6f7a8b
    (before first heading) [2/4]
    ## Indexes [12/31]
      ### Partial indexes [4/9]
    ## Performance [9/22]
  ```

- `scope` is a folder in the knowledge trees (`Research/Main Notes`) or one note (`"[[SQLite]]"`). With no scope, every note in the knowledge trees except Weekly Notes, sorted by path.
- Weekly Notes are never in the Outline, and `outline` refuses `Research/Weekly Meetings` as a scope, pointing at `recall <terms…>`. Inbox Dumps and Briefings are never in it either.
- The cap is 48,000 characters, about 12k tokens. Over the cap, the Outline drops Sections below the second level; still over, it lists notes only. Either way it ends with `(cut: narrow with outline <folder> or outline "[[Note]]")`.
- `outline --json` gives `[{note, tags, digest, filed, hash, sections: [{name, heading, level, bullets, lines, sections: […]}]}]`, uncapped, for the benchmark and tests.

### 03 BM25 Sections

- `recall <terms…>` ranks Sections by BM25 over their own text, computed fresh on each call, with nothing stored. Terms are split with the duplicate module's word pattern and stopword list; `k1 = 1.2`, `b = 0.75`.
- A Section's text for ranking is its own text with its ancestors' heading names in front, since names carry meaning.
- Term search covers every Section in the knowledge trees, Weekly Notes included; filed lines stay out (Items cover them).
- The result gains `sections`, capped at 10, beside the unchanged `results` and `more`: `{"results": […], "more": N, "sections": [{"note", "section", "score", "bullets", "lines"}], "moreSections": M}`. `section` is the full Obsidian heading link.
- Items are matched and ranked as today.
- `--project` and `--links` are unchanged.
- ADR 0013 records ranking by BM25 computed per call, amending ADR 0007's "plain term match".

### 04 Benchmark

- `bun run bench` in `evals/`, outside `bun test`, `eval:check` and CI. It reads the real Vault only through `brain-dump` commands and writes only under `~/.local/state/brain-dump/bench/`.
- **Questions**, kept in that folder:
  - **From filed Items:** each backlinked Item becomes a question, paraphrased by the generator. Its gold is the note it is filed in, scored at note level.
  - **Synthetic:** for each Section with at least 3 bullets, the generator writes 2 questions that its text answers, told to paraphrase rather than reuse its words. Gold is that Section.
  - **Hand-written:** `questions.txt`, one `<question> → [[Note#Section]]` per line, written by the user.
  - `bun run bench --generate` (re)writes the first two sets; the hand-written file is never touched.
- **Candidates:**
  - **A, BM25:** the top 3 of `recall <terms…>`'s `sections`, with the question as terms.
  - **B, full Outline:** one tool-less model call given the uncapped Outline and the question, answering up to 3 Section names.
  - **C, drill-down:** a call given note lines only picks up to 3 notes; a second call given those notes' Outlines picks up to 3 Sections.
  - **D, hybrid:** B's call with A's top 10 listed beside the Outline.
- Model calls use the tool-less, unsaved spawn of ADR 0009. Each candidate runs with the pinned drafting model and one stronger model, both constants in the benchmark.
- **Scoring:** Recall@1 and Recall@3 per candidate and model, per question set and overall; the share of answers naming a Section that `show` refuses; Outline characters sent. Results go to a dated JSON file and a printed table.
- **Decision rule:** the default for the `recall` skill is the candidate with the best overall Recall@3 that fits the 12k-token cap; a tie goes to the cheaper one. The result and date are recorded under Further Notes in this spec.
- Generating questions and running B to D send Section text and the Outline to the model provider. That is the same boundary as Recall itself (ADR 0007).

### 05 Recall skill and eval

- The `recall` skill gains `outline` and Section `show`, in this order:
  1. `recall --project` when starting work in a repo, as today.
  2. `recall <terms…>` for a specific question: Items and Sections.
  3. `outline` when the terms miss or the question is broad, in the form 04 picked (whole, scoped, or with term results beside it).
  4. `show` on at most 3 Sections, then answer.
- Answers cite each Section as `[[Note#Section]]` and each Item as today. Nothing found is said plainly.
- A new `recall` eval: a synthetic fixture Vault of headed Topic Notes and a Project Note, and about 10 questions, each with one gold Section. The skill runs headless with only `Bash(brain-dump:*)`.
- Assertions: the reply cites the gold Section, and the run made at most 3 Section `show` calls, counted by a `brain-dump` shim on the eval's `PATH` that logs each call before passing it on. 3 runs per question, all must pass.
- The eval's inputs include the skill, the Section module, `outline`, `show` and the ranking code through its imports, so changing any of them makes it stale.

### 06 Filing reads the Outline

- The file skill's step 1 runs `brain-dump outline` once per run in place of `list-notes`, and takes tags and each note's `hash` from it. The heading "Load the Inbox and the Vault's map" becomes "Load the Inbox and the Outline".
- When the Outline is cut, the skill reads `outline` scoped to the folders the Dump's Items point at.
- Destinations are still notes: Items go at the note's end, as today (see Further Notes).
- The plan table's destination cell may name the Section that made the match: `SQLite` (matched `## Performance`).
- `list-notes` stays, for the pointer hook and the evals.
- The File eval reruns; its fixture Vault gains headings so a match by Section can be checked.

## Testing Decisions

- A good test drives behaviour through an interface and asserts what a caller sees; it survives refactors.
- **The Section module is a pure format module** (ADR 0010): tested directly on notes with every edge case: text before the first heading, no headings, skipped levels, repeated headings, headings holding characters Obsidian drops, filed lines and Digests placed before, between and after headings, CRLF notes.
- **`outline`, `show` and `recall` are tested at the commands** (ADR 0002) against the harness's fixture Vault: the text and JSON Outline, scoping, Weekly Note refusal, the cap and its cut line, Section and `--filed` output, ambiguous and unknown names with their suggestions, BM25 ordering on a fixture built so a rare term must outrank a common one, and the unchanged `results` shape.
- **The benchmark is not tested by `bun test`**: it reads a private Vault and calls a model. Its question parsing and scoring are small functions with a unit test each.
- **The `recall` eval** joins the existing evals (seam 3 of the v2 spec), recorded in `passed.json` and gated by `eval:check`.

## Out of Scope

- Training or fine-tuning a model, embeddings, a vector database, or any stored index.
- Placing filed Items under a Section instead of at the note's end.
- Weekly Notes in the Outline.
- Changes to the pointer hook.
- Committing benchmark questions, results or anything else drawn from the real Vault.
- `file` in Codex (unchanged from v2).

## Further Notes

**Later, outside this spec:**
- **Filing a finished week:** at the start of a new week, offer to file what last week's Weekly Note holds, so a week's notes reach Topic Notes and Project Notes instead of staying only in the week.
- **Filed Items under Sections:** placing each Item under the Section it fits would give it a meaningful name, but Digests are positional (ADR 0008): a Digest covers what follows the previous one, and `check` counts Items after it. Placement needs Digest coverage and `check` to move from position to Dump date first.

**Verify during the build:**
- [x] The characters Obsidian drops from heading links, and whether Obsidian matches heading links ignoring case, so names written here resolve when clicked. Checked in Obsidian 1.14.5's bundled app (its `stripHeadingForLink`, `stripHeading` and `resolveSubpath`; the first two are documented in the `obsidian` API's `obsidian.d.ts`): a link Obsidian writes turns `:`, `#`, `|`, `^`, `\`, line breaks, `%%`, `[[` and `]]` into spaces and collapses them. To resolve a link it turns every ASCII punctuation character but `'`, `-` and `_` into a space on both sides, collapses whitespace, trims, and compares ignoring case. Each `#` part must match a heading deeper than the last, and the first match wins. Names here are written the first way and matched the second way. Where Obsidian would quietly take the first of several matches, `show` refuses instead.
- [ ] The real Vault's Outline with sizes fits the 48,000-character cap without a cut, or by how much it misses (names alone measured about 42k characters outside Weekly Notes).
- [ ] The eval runner's `PATH` override reaches the `brain-dump` the skill calls, so the shim can count `show` calls.

**Benchmark result:** recorded here when 04 is done: date, models, each candidate's Recall@1 and Recall@3, and the default chosen.
