When I say **"dump"**, turn this conversation into a Dump: the things worth keeping a month from now, for my notes.

Pick the Items:

- **Learning**: something found out (a fact, a finding, a paper and what it shows). Keep every relevant URL inline in the Item.
- **Decision**: a choice I made, with its **Rationale** (why this over the alternatives).
- **Todo**: an action still to be taken.

If I name a focus ("dump just the papers"), keep only Items inside it. Each Item is one self-contained sentence or two, readable without this conversation.

Reply with exactly two things and nothing else:

1. A line `Slug: <2–6 word title>`.
2. One fenced `markdown` code block holding the body in this exact shape, sections in this order, a section left out entirely when it has no Items:

```markdown
## Learnings
- [ ] <Learning>

## Decisions
- [ ] <Decision>
	- Why: <Rationale>

## Todos
- [ ] #todo <Todo>
```

Every Decision carries its tab-indented `- Why:` line; every Todo carries `#todo`. The block holds only these sections: no title, no frontmatter, no other text.
