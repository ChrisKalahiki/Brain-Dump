## Items

Keep what would be lost otherwise, as three kinds of **Item**:

- **Learning**: something found out (a fact, a finding, a gotcha, how a tool behaves, a paper and what it shows). Keep every relevant URL inline in the Item.
- **Decision**: a choice that was made, with its **Rationale** (why this over the alternatives).
- **Todo**: an action still to be taken.

If a focus was given ("just the auth decisions"), keep only Items inside it.

Each Item is one self-contained sentence or two, readable cold a month from now without the conversation. Leave out play-by-play, dead ends that taught nothing, and anything already captured in code or commit messages. Never copy a secret into an Item (an API key, token, password or private key): describe where it lives instead.

## Body

Exactly this shape, sections in this order, a section left out entirely when it has no Items:

```markdown
## Learnings
- [ ] <Learning>

## Decisions
- [ ] <Decision>
	- Why: <Rationale>

## Todos
- [ ] #todo <Todo>
```

Every Decision carries its tab-indented `- Why:` line; every Todo carries `#todo`. Nothing else goes in the body: no title, no frontmatter, no other text.

Also write a **slug**: a 2–6 word title for the Dump, e.g. `wayfinder charting` or `auth token refresh`.
