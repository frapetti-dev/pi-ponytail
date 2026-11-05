# Band metric sources

Type: research
Status: resolved
Blocked by: none

## Question

For every field of upstream's `Band` type (`hooks/band/types.d.ts`: level, model, cost, spent, turns, turnCosts, tokens{input,output,cacheRead,cacheWrite}, busyMs, name, project, session, reused, created, removed, openCallers, tests), name the omp 18.13.2 event or API that supplies it, with the exact field path.

Cover:
- `turn_end`/`message_end` `usage` and `usage.cost.total`
- agent time from `agent_start`/`agent_end` or turn timestamps
- test runs via omp's `bash` tool in `tool_call`/`tool_result` (tool name and the input/output fields)
- created/reused/removed definitions from omp's `edit` and `write` tool inputs. omp's edit uses a hashline patch format, so state how to extract added and removed lines.
- Task boundaries: which events fire on /new, /resume, /fork, /branch (`session_switch`, `session_branch`)
- session id and model id

Also list which upstream `hooks/band/metrics.ts` exports are pure and importable from the npm package as-is under Bun (`snapshot`, `markdown`, `upsertCsv`, `resume`, `percent`, `testCounts`, `isTestCommand`, `defsIn`, `callsIn`, `CSV_HEADER`, ...), and which depend on the Claude SDK.

## Answer

- Every `Band` field has an omp source. Cost and tokens come from `ctx.sessionManager.getUsageStatistics()` (`cost`, `input`, `output`, `cacheRead`, `cacheWrite`), read at the terminal `agent_end` as `stats - baseline`. That total already includes subagent spend through `task` results. `model` is `AssistantMessage.model`, `session` is `getSessionId()`, `name` is `getSessionName()`, and `busyMs` is `agent_start` to `agent_end` wall time.
- Upstream's "turn" is one prompt answer, so it maps to a terminal `agent_end` (`willContinue !== true`), not omp's per-LLM-call `turn_end`.
- Tests: `bash` `tool_result` has `input.command`, `isError` (true on non-zero exit) and `content[].text`. Reuse, created and removed: use `edit` `tool_result` `details.oldText`/`newText` (or `perFileResults[]`), because a hashline patch carries added `+` rows but not removed text. For `write`, read the file in `tool_call` and take `input.content`.
- Task boundaries: `/new`, `/resume` and `/fork` fire `session_switch`. `/branch` and `/btw` fire `session_branch`. `/clear` fires no extension event and keeps the session id, but appends a `reset_boundary` entry. Gate everything on `ctx.agent.kind === "main"`.
- `metrics.ts` is shipped in the tarball. All its exports are pure, and it runs under Bun through `createRequire(...).resolve("@dietrichgebert/ponytail/package.json")` plus a dynamic `import(pathToFileURL(root + "/hooks/band/metrics.ts"))`. The deep specifier fails because of the `exports` map. Only `register.tsx` needs the Claude SDK. Not reusable: `mainModel` and `sessionTitle`, which parse Claude transcripts.

Details and citations: [research](../research/band-metric-sources.md)
