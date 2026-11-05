# Task and Ledger row

Type: grilling
Status: resolved
Blocked by: 02

## Question

What exactly is a Task in omp? Settle:
- when a Task starts and ends (session start, /new, /resume, /fork, /branch, compaction)
- the Ledger row key (upstream: `${session.slice(0,8)}-${startedAt}`)
- how `project` is derived (cwd basename, git toplevel, worktree mapping)
- the `level` and `model` column values
- whether resumed sessions continue a row (upstream `resume()`)
- when the row is written (every turn upsert, as upstream)

## Answer

Decided with the user (grilling). Sources: [research/band-metric-sources.md](../research/band-metric-sources.md) sections 5, 6 and 8.

- **Task start.** A new Task, and with it a new Ledger row, starts on:
  - `session_start`
  - `session_switch` (`/new`, `/resume`, `/fork`)
  - `session_branch` (`/branch`, `/fork <entry>`, `/btw`)
  - `/clear`

  `/clear` fires no extension event. Detect it in `before_agent_start` when `ctx.sessionManager.getBranch()` contains a `reset_boundary` entry whose id differs from the last one seen. `session_compact` and `session_tree` are **not** boundaries. A Task ends when the next one starts or on `session_shutdown`.
- **Baseline.** At every Task start, store `ctx.sessionManager.getUsageStatistics()` as the baseline. `spent` and tokens are the current stats minus that baseline, which covers `/fork` (inherited cost) and `/clear` (same cumulative totals).
- **Row key.** Use upstream `taskKey(sessionId, startedAt)`.
  - `sessionId` = `ctx.sessionManager.getSessionId()`.
  - `startedAt` = `Date.parse(ctx.sessionManager.getHeader().timestamp)`. After a `/clear`, use instead `Date.parse()` of that `reset_boundary` entry's `timestamp`.
  - So `/resume` keeps the key, and every cleared Task gets its own row.
- **Resume.** On a Task start, call upstream `resume(band, csv, key)` against the project's Ledger file. If a row with that key exists (the `/resume` case), the counters continue from it.
- **project.** Same as upstream: `basename(gitToplevel ?? cwd)`.
  - `gitToplevel` is the trimmed stdout of `pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd })` when the exit code is 0. Otherwise use `ctx.cwd`.
  - A git worktree is its own project, with no mapping to the main repo, so rows match what Claude Code ponytail writes for the same checkout.
  - Ledger file: `${XDG_CONFIG_HOME ?? `${HOME ?? USERPROFILE}/.config`}/ponytail/band/${project.replace(/[^\w.-]/g, "_")}.csv`, reimplementing upstream's private `ledgerDir` and `ledgerFile`.
- **level column.** The Level when the row is written: `resolveSessionMode(ctx.sessionManager.getBranch(), readDefaultMode())`.
- **model column.** `${provider}/${model}`, for example `anthropic/claude-sonnet-4-5`.
  - It is the value that wrote the most assistant replies in the Task, counted on `message_end` from `event.message.provider` and `event.message.model`.
  - Before the first reply, fall back to `${ctx.model.provider}/${ctx.model.id}`.
  - This deliberately differs from Claude Code ponytail's bare `claude-*` ids. It shows the provider for non-Anthropic models.
- **Write timing.** Upsert the row with upstream `snapshot()` and `upsertCsv()` at every terminal `agent_end` (`willContinue !== true`), and send `webhookRequest()` with the same row at the same moment, as upstream does on `turn.complete`.
- **Subagents.** Every Task, Ledger and webhook handler returns early unless `ctx.agent.kind === "main"`. Subagent spend still reaches the row through the parent's `getUsageStatistics()`.
- **Unverified:** that `getBranch()` returns `reset_boundary` entries unfiltered was read from source only. If the build finds they are filtered out, detect `/clear` with `ctx.sessionManager.getEntries()` instead.
