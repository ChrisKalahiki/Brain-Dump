# Term Recall ranks Sections by BM25, computed on each call

ADR 0007 made free-text Recall "a plain term match in the helper, with no index to keep in sync across machines". Recall now also reaches Sections of hand-written notes, and a plain count of matched terms weighs a word found in every note the same as a rare name. `recall <terms…>` therefore ranks Sections by BM25 over their text, worked out from the notes on every call. Nothing is stored, so the reason ADR 0007 gave for having no index still holds: two machines can't disagree about something neither keeps.

This amends ADR 0007's wording only. Agents still read the Vault through the helper alone, within the write allowlist, and Item results are matched as before.

## Considered Options

- **Keep counting matched terms**, over Sections: no new code, but common words would decide the ranking across hundreds of Sections.
- **A stored index or embeddings**: faster on a large Vault, but it must be rebuilt and kept in step on each machine, and a stale one ranks against notes that have changed. The allowlist is small enough (about 1.2 MB) to score on each call.
