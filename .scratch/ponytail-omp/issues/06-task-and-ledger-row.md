# Task and Ledger row

Type: grilling
Status: open
Blocked by: 02

## Question

What exactly is a Task in omp? Settle:
- when a Task starts and ends (session start, /new, /resume, /fork, /branch, compaction)
- the Ledger row key (upstream: `${session.slice(0,8)}-${startedAt}`)
- how `project` is derived (cwd basename, git toplevel, worktree mapping)
- the `level` and `model` column values
- whether resumed sessions continue a row (upstream `resume()`)
- when the row is written (every turn upsert, as upstream)
