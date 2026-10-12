## Learnings
- [ ] SQLite's `busy_timeout` pragma makes a second writer wait for the lock instead of failing at once with SQLITE_BUSY.

## Decisions
- [ ] Harbor fetches each station's tide table at most once a day instead of on every command.
	- Why: NOAA rate-limits the API, and tide predictions for a day don't change once published.

## Todos
- [ ] #todo Evict Harbor cache rows older than 30 days when the cache opens.
