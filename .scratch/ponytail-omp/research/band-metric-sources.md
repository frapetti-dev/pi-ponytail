# Band metric sources (ticket 02)

Answers: for every field of upstream's `Band` type, which omp 18.13.2 event or API supplies it, and which `hooks/band/metrics.ts` exports pi-ponytail can reuse as-is.

## Sources used

- Upstream `DietrichGebert/ponytail` at commit `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` (version 5.3.3): full `git clone` + `git checkout` into `%TEMP%/pt-r02`. Cited below as `upstream:<path>`.
- The npm tarball `@dietrichgebert/ponytail@5.3.3`, installed with `bun add` (Bun 1.4.4) into a scratch project at `%TEMP%/pt-r02-scratch`. Used only to prove importability.
- omp 18.13.2 source. Cited as `omp:<pkg>/<path>`, where `omp:` is `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/`. Package `pi-coding-agent` is abbreviated `cod`, so `omp:cod/src/...` is `@oh-my-pi/pi-coding-agent/src/...`.
- No `.omp` directory was read.

## 1. How upstream computes each field (the thing we must replicate)

All from `upstream:hooks/band/register.tsx` (Claude SDK) and `upstream:hooks/band/types.d.ts:9-28`.

| Band field | Upstream source (Claude Code) |
|---|---|
| `level` | `readLevel($)` (register.tsx:95-105, reads the flag file ponytail's own hooks write); refreshed on every `turn.complete`. |
| `model` | `readModel` greps the transcript for `"model":"claude-…"` and `mainModel()` picks the one that wrote most replies (register.tsx:121-126; metrics.ts:164-169). |
| `cost` | Baseline: the last-seen session total, `usage.cost.usd` from `$.session.usage()` (register.tsx:200-214, 320-340). |
| `spent` | The task's cost: `usage.cost.usd` (session total since start or last /clear). Snapshot writes this as `cost_usd` (metrics.ts:236). |
| `turns` | `$.session.turns()` on every `turn.complete`. A Claude "turn" is one prompt-to-answer cycle (`turn.complete` carries `durationMs` and `answer`; tests/band.test.tsx:362-364). |
| `turnCosts` | Per-turn delta `cost - baseline`, last 20 kept (register.tsx:~325-338, `.slice(-20)`). |
| `tokens` | Sum of each `turn.complete` `e.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) through `addTokens` (metrics.ts:139-146). Subagent tokens are added too (register.tsx:~293-296). |
| `busyMs` | `b.busyMs + e.durationMs` per `turn.complete`. |
| `name` | Sidebar title from the transcript (`sessionTitle`), else the first non-slash prompt's first line, max 60 chars (register.tsx `prompt.submit` handler). |
| `project` | `base(repo.root ?? cwd)` (register.tsx:200-214). |
| `session` | `$.session.id()`. |
| `reused` / `created` / `removed` | On `tool.call` for Edit/Write inside the project: `defsIn(file, before)` vs `defsIn(file, after)`; `created` = new names in a source file, `removed` = names that disappeared, `reused` = `callsIn(addedLines(before, after), known, newDefs)`. `known` = `parseDefs(git grep --untracked -nE GREP_DEFS)` taken at session start. |
| `openCallers` | At `turn.complete`: for each removed name, `git grep --untracked -nw -e name`; if no row still defines it but call sites remain, the name stays in `removed` and the `file:line` refs go into `openCallers`. `removed` is *replaced* by the still-removed list each turn. |
| `tests` | On `tool.call` for Bash with `isTestCommand(command)`: `{state: isError ? 'fail' : 'pass', ...testCounts(output)}`. An Edit/Write of a code file flips `pass`/`fail` to `stale`. |

Fields with no omp counterpart: `transcript` (Claude transcript path, only used for title and model lookup) and `details` (UI fold flag, kept in Claude's `$.store`). pi-ponytail owns `details` itself.

## 2. Field-by-field table for omp 18.13.2

Handler signature for every event: `pi.on(name, (event, ctx) => ...)` (omp:cod/src/extensibility/extensions/types.ts:1727-1798). `ctx` is `ExtensionContext` (types.ts:680-824).

| Band field | omp event or API | Exact path |
|---|---|---|
| `level` | Upstream extension's own state (ticket 01). Persisted as a session entry; re-read on `session_start`, `session_switch`, `session_branch`, `session_tree`. | `ctx.sessionManager.getBranch()` entries with `type === "custom"`, `customType === "ponytail-mode"`, value at `entry.data.mode`. Upstream exports the reader: `resolveSessionMode(entries, fallbackMode)` (upstream:pi-extension/index.js:32-45). Fallback = `getDefaultMode()` from `hooks/ponytail-config.js`. |
| `model` | `message_end` (role `assistant`) or `turn_end`. | `event.message.model` (bare id) and `event.message.provider` (`AssistantMessage`, omp:pi-ai/src/types.ts:1268-1281). Fallback when no reply yet: `ctx.model?.id` or `ctx.models.current()?.id` (types.ts:500-511, 702-704). Keep a per-Task `Map<string, number>` and use upstream's rule "model that wrote most replies". |
| `cost` (baseline) | Internal bookkeeping, not written to the Ledger. | Last seen `ctx.sessionManager.getUsageStatistics().cost`. |
| `spent` | `agent_end` (terminal). | `ctx.sessionManager.getUsageStatistics().cost` minus the Task's baseline. `UsageStatistics` is defined at omp:cod/src/session/session-entries.ts:396-409. It sums `Usage.cost.total` of every assistant message, every `model_usage` entry, and every completed `task` tool result's `details.usage` (omp:cod/src/session/session-manager.ts:417-449, 592-598). So it already includes subagent spend, compaction and other `model_usage` spend. Per-message alternative: `event.message.usage.cost.total` on `message_end` (Usage type: omp:pi-catalog/src/types.ts:210-275; `cost: {input, output, cacheRead, cacheWrite, total}`). `ctx.sessionManager` is `ReadonlySessionManager`, which includes `getUsageStatistics` (session-manager.ts:724-748). |
| `turns` | `agent_end` with `willContinue !== true`. | Count it yourself. omp's `turn_end` fires per LLM call (many per prompt), so it is not upstream's "turn". `AgentEndEvent.willContinue` is set when the settle is not terminal (omp:cod/src/extensibility/shared-events.ts:205-221; mapped at lifecycle-mirror.ts:122-128). |
| `turnCosts` | `agent_start` and terminal `agent_end`. | `getUsageStatistics().cost` at `agent_end` minus the value read at `agent_start`; keep the last 20. |
| `tokens.input` / `.output` / `.cacheRead` / `.cacheWrite` | `agent_end` (read stats) or `message_end` (sum payloads). | `getUsageStatistics().input / .output / .cacheRead / .cacheWrite` (names match upstream's `Tokens` exactly). Per message: `event.message.usage.input / .output / .cacheRead / .cacheWrite` (pi-catalog types.ts:210-219). `Usage.input` is the non-cached bucket, like Claude's `input_tokens`. `getUsageStatistics().totalTokens` also counts orchestration tokens, so compute totals with upstream's `totalTokens(t)` (sum of the four), not that field. Includes subagent tokens through task results. |
| `busyMs` | `agent_start` / `agent_end`. | Stamp `Date.now()` at `agent_start`; add `Date.now() - stamp` at every `agent_end` (terminal or not; a `willContinue` end is followed by another `agent_start`, agent-loop.ts:724-729). Alternatives: `turn_start.timestamp` (shared-events.ts:224-228). Do **not** use `AssistantMessage.duration` (omp:pi-ai/src/types.ts:1353): that is provider request time only and excludes tool execution. |
| `name` | `ctx.sessionManager.getSessionName()` or `pi.getSessionName()` (types.ts:1991), read at each `agent_end` because the auto-title is generated asynchronously after the first reply. Fallback: first line (max 60) of the first non-`/` user prompt from `input` (`event.text`, types.ts:1283-1288) or `before_agent_start` (`event.prompt`, types.ts:1091-1099). | `ctx.sessionManager.getSessionName(): string \| undefined` (session-manager.ts:3362). Title lives in `SessionHeader.title` (session-entries.ts:38-45). |
| `project` | Not event-driven; compute at session start and at every Task boundary. | `ctx.cwd` / `ctx.sessionManager.getCwd()` (session-manager.ts:3046) for the cwd. Repo root: `pi.exec("git", ["rev-parse","--show-toplevel"], {cwd})` (types.ts:1955; `ExecResult {stdout, stderr, code, killed}`, omp:cod/src/exec/exec.ts:9-24). Upstream takes `basename(repo.root ?? cwd)`. Exact rule is ticket 06. |
| `session` | Any handler. | `ctx.sessionManager.getSessionId()` (session-manager.ts:3205). Upstream key uses `session.slice(0, 8)`. |
| (Task start time for `taskKey`) | Session header. | `ctx.sessionManager.getHeader()?.timestamp` (ISO string; `SessionHeader.timestamp`, session-entries.ts:38-45) -> `Date.parse(...)` for `snapshot(b, startedAt)`. Ticket 06 decides the key. |
| `reused` / `created` / `removed` | `tool_call` for `write`; `tool_result` for `edit`. See section 3. | `write`: `event.input.path`, `event.input.content`. `edit`: `event.details.oldText` / `.newText` / `.path`, or `.perFileResults[i]` for multi-file edits. |
| `openCallers` | `agent_end` (terminal). | `pi.exec("git", ["grep","--untracked","-nw","-e", name], {cwd})` -> `stdout`; then `hits()` / `defsIn()` from metrics.ts, same algorithm as upstream. |
| `tests` | `tool_call` + `tool_result` for `bash`. See section 4. | `event.input.command`, `event.isError`, `event.content[0].text`. |
| `known` (reuse baseline) | `session_start` and Task boundaries. | `pi.exec("git", ["grep","--untracked","-nE", GREP_DEFS], {cwd})` -> `parseDefs(stdout)`. |

### Timing caveat for reading session stats

`message_end` persistence runs as `messageEndPersistence`, concurrently with the extension fan-out (omp:cod/src/session/agent-session.ts:4552, 4605-4619). `agent_end` is emitted after the run settles. [INFERENCE] A `message_end` or `turn_end` handler may therefore see `getUsageStatistics()` one message behind. Read stats at `agent_end`, or sum `event.message.usage` from the payload yourself.

### Subagents

- Extension factories are rebound to every subagent session, and `ctx.agent` says which one you serve: `{kind: "main" | "sub", id, name, depth, parentId}` (omp:cod/src/extensibility/extensions/types.ts:520-546, 746; task executor note at omp:cod/src/task/executor.ts:530).
- The Band, Ledger row and webhook MUST be gated on `ctx.agent.kind === "main"` (and `ctx.hasUI` for the widget, types.ts:692).
- A subagent's own `tool_call`/`tool_result` events fire on the subagent's runner, not the parent's [INFERENCE from the rebinding doc; ticket 03 owns the subagent question]. The parent's `getUsageStatistics()` still includes the child's cost and tokens through the `task` tool result (session-manager.ts:417-424, 592-598). Upstream gets the same split: subagent tokens are added, subagent cost is already in the session cost. Reuse, created, removed and tests from subagent edits are not visible to the parent band unless instances share module-level state [INFERENCE; the module is imported once per process, the factory is called again per session].

## 3. Created / reused / removed definitions: `edit` and `write`

Upstream's rule needs `before` and `after` text of the touched file (register.tsx, `tool.call` handler). omp provides them differently per tool.

### `write`

- `tool_call.input` = `{path: string, content?: string}` (omp:cod/src/tools/write.ts:218-224, `WriteToolInput`). `path` may be relative or use an internal scheme (e.g. `local://`); resolve against `ctx.cwd` and skip non-filesystem schemes. `content` may be absent for some schemes.
- `before`: read the file from disk inside the `tool_call` handler (it may be async), `""` when missing, exactly as upstream does with `$.fs.read(file).catch(() => '')`. `after = input.content`.
- `tool_result.details` is `undefined` per the type (types.ts:1482-1485) but the runtime value is `{ resolvedPath, diagnostics?, madeExecutable?, meta? }` (omp:cod/src/tools/write.ts:1149, 1183, 1189-1196). There is no before/after text there. Use `details.resolvedPath` as the absolute path if present (type mismatch: [INFERENCE] do not rely on it, fall back to resolving `input.path`).
- Gate on `!event.isError` in `tool_result` before committing counters (upstream drops denied or errored calls: `ran.deny !== undefined || ran.isError`). So read `before` in `tool_call`, stash it by `toolCallId`, and commit in `tool_result`.

### `edit`

The edit tool has five modes, chosen by setting `edit.mode` (default `hashline`, env `PI_EDIT_VARIANT`; omp:cod/src/edit/settings.ts:29-48). `tool_call.input` is `Record<string, unknown>` (types.ts:1424-1427), and its shape depends on the mode (omp:cod/src/edit/schemas.ts):

| Mode | `event.input` |
|---|---|
| `hashline` (default) | `{input: string}`, a hashline patch |
| `sloppy`, `apply_patch` | `{input: string}` |
| `replace` | `{path, old_string, new_string, replace_all?}` |
| `patch` | `{path, edits: [{op?, rename?, diff?}]}` |

`normalizeToolEventInput` adds `path` (single file) or `paths` (several) for hashline-style input by parsing the `[PATH#TAG]` headers (omp:cod/src/extensibility/tool-event-input.ts:69-91). So `event.input.path` / `.paths` is the target on both `tool_call` and `tool_result`.

**Preferred route, mode-independent: use the result, not the input.** `tool_result` for `edit` carries `event.details: EditToolDetails` (omp:pi-tui/src/tools/edit.ts:97-124):
- single file: `details.path` (absolute), `details.oldText` (undefined for create), `details.newText` (undefined for delete), `details.op` (`create | update | delete`), `details.sourcePath` / `details.move` on rename.
- several files: `details.perFileResults[i]` with the same fields, `isError?`, `errorText?`. Assembled at omp:cod/src/edit/index.ts:237-287.
- Both are dropped (`snapshotsPruned: true`) when the engine prunes oversized files, and in multi-file results once the combined `oldText`+`newText` exceeds 32,768 chars (`MAX_EDIT_SNAPSHOT_TEXT_CHARS`, edit/index.ts:289-310; native flag at omp:pi-natives/native/index.d.ts:1774-1794). The per-file native limit is not exposed in the TS sources [INFERENCE: not found].
- A failed edit has `details.diff === ""` and `details.errorKind` set (omp:pi-tui/src/tools/edit.ts:97-102; edit/index.ts:570), and `event.isError` is true. Skip those.
- Pruned or missing snapshots: parse `details.diff`, a numbered unified diff. Rows match `^([+\-\s]\s*(\d+)[|│])(.*)$` or `^([+\-\s]\s*(\d+)\s)(.*)$` (the TUI parses it that way, omp:pi-tui/src/tools/edit.ts:503-510). `+` rows are added lines, `-` rows removed lines. Feed added text to `callsIn`, and compute defs with `defsIn` on added vs removed rows. This is coarser than whole-file defs (a def name on a changed line only). Prefer the whole-file route when snapshots are present.

**Extracting added and removed lines from a raw hashline patch (fallback, and what "state how" asks for).** Grammar: omp:hashline/src/grammar.lark; prompt: omp:cod/src/edit/hashline-compact.md.
- File sections start `[PATH#TAG]` (4-hex tag). Hunks are `PUT <locator>:` + body rows, `PUT <locator> @name` (paste), `CUT <locator> [@name]`, `REM`, `MV DEST`.
- **Added lines** = body rows of `PUT ...:` hunks. Each row starts with `+`; strip exactly one leading `+` (a blank body row is a lone `+`; a literal `+ x` is written `++ x`). Rows of other hunk types start with an op keyword, never `+`. Hunks of one section never inline unchanged lines.
- **Removed lines are not in the patch.** The patch carries only line numbers: `PUT N.=M:` replaces lines N..M, `PUT N*:` replaces the syntax block at N, `CUT N.=M` / `CUT N*` delete, `REM` deletes the file, paste ops (`@name`) re-insert previously cut text. To know the removed text you need the pre-edit file lines `N..M` (read the file in `tool_call`) or a `LID` to block extent (needs the tree-sitter block rules), so the raw-patch route cannot reproduce removed names reliably. This is why `details.oldText` / `.newText` is the recommended source.
- `apply_patch`/`patch`/`sloppy` modes: `-`/`+` unified-style diffs per `edits[].diff` or the `input` text; same conclusion, use `details`.

**Summary for `edit`:** in `tool_result`, if `!isError`, for each file result take `(path, oldText ?? "", newText ?? "")`, then run the same code as upstream (`defsIn`, `isSource`, `isCode`, `callsIn(addedLines(before, after), known, newDefs)`), after the `inProject(file, root)` filter. `inProject` works with either slash on Windows (metrics.ts:79-84).

## 4. Test runs through `bash`

- `tool_call`: `event.toolName === "bash"`, `event.input = {command: string, timeout?, cwd?, pty?, async?, name?, ready?}` (omp:cod/src/tools/bash.ts:383-391; `BashToolCallEvent`, types.ts:1414-1417). Match with `isToolCallEventType("bash", event)` or `toolName === "bash"`.
- `tool_result`: `toolName === "bash"`, `event.input` (same object, `command` included), `event.content: (TextContent | ImageContent)[]` (output text is `content.filter(c => c.type === "text").map(c => c.text).join("\n")`), `event.isError: boolean`, `event.details: BashToolDetails | undefined` (types.ts:1467-1470).
- Pass/fail: a non-zero exit sets `isError` true (`failedExit` -> `resultBuilder.error()`, omp:cod/src/tools/bash.ts:722-738, 801-805), with `details.exitCode` set only on failure (bash.ts:760-762). Timeouts also come back as `isError` with `details.timedOut` (bash.ts:746-792). Aborted or missing exit status throws, so the wrapper sets `isError: true` as well (omp:cod/src/extensibility/extensions/wrapper.ts:508-514, 533).
- Mapping: `state = event.isError ? "fail" : "pass"`, plus `testCounts(text)`. Exclude `details.timedOut` from `fail` if desired [design choice, not required].
- Output text is capped inline (`enforceInlineByteCap`), truncation keeps the tail (`direction: "tail"`, bash.ts:787-803), so runner summary lines (end of output) survive.
- Gotcha: `input.async === true` returns a background-start result immediately, with `details.async.state` set (omp:pi-tui/src/tools/bash.ts:81-85). The start notice has no test output, so skip `tests` updates for async calls [INFERENCE: handle explicitly].
- Gotcha: a user `!` command goes through `user_bash`, not `tool_call` (types.ts:1253-1266); upstream's Band only follows agent tool calls, so ignore it.
- Stale rule: after a code `write`/`edit`, upstream flips `tests.state` from `pass`/`fail` to `stale` (register.tsx, Edit/Write handler: `isCode(file) && b.tests.state !== 'none'`).

## 5. Task boundaries: which events fire

Verified in omp:cod/src/session/agent-session.ts and shared-events.ts:29-75. In every case below the session manager already points at the new session when the handler runs.

| User action | Event | Payload | Source |
|---|---|---|---|
| process start | `session_start` (once) | `{}` | omp:cod/src/modes/runtime-init.ts:212 |
| `/new` | `session_switch` | `reason: "new"`, `previousSessionFile` | agent-session.ts:11294-11298 |
| `/resume` | `session_switch` | `reason: "resume"`, `previousSessionFile` | agent-session.ts:13073-13077 |
| `/fork` (no entry id) | `session_switch` | `reason: "fork"`, `previousSessionFile` | agent-session.ts:11416-11420 |
| `/fork` with entry id (branch of the transcript) | `session_branch` | `reason: "fork"` | agent-session.ts:11350, 13356-13445 |
| `/branch` (alias `/rewind`; rewind to a user message) | `session_branch` | `reason: "branch"` | agent-session.ts:13330-13345, 13440-13444; slash-commands/builtin-session.ts:616-625 |
| `/btw` promote | `session_branch` | `reason: "btw"` | agent-session.ts:13568-13572 |
| `/tree` navigation | `session_tree` | `newLeafId`, `oldLeafId`, `summaryEntry?` | agent-session.ts:13908-13912; same session id |
| compaction (manual or auto) | `session_compact` | `compactionEntry` | session-maintenance.ts:2560-2563, 4550-4554; same session id |
| `/clear` | **no extension event** | n/a | `resetSessionContext()` emits nothing and keeps the session id; it appends a `reset_boundary` entry (agent-session.ts:6547-6628, session-manager.ts:3666-3670) |
| shutdown | `session_shutdown` | `{}` | shared-events.ts:104-107 |

Cancellable "before" variants exist: `session_before_switch` (`reason: new|resume|fork`), `session_before_branch` (`reason`, `entryId`) (shared-events.ts:34-67).

Upstream's pi extension confirms the split: "Pi re-emits session_start on /new, /resume and /fork; OMP emits session_switch and session_branch instead" (upstream:pi-extension/index.js:212-218), and it re-reads the Level on `session_tree`, `session_switch`, `session_branch`.

Facts that matter for Task and Ledger-row design (ticket 06):
- **`/clear` is invisible to extensions and keeps the same session id and the same `usage` totals.** Claude's `/clear` is a Task boundary for upstream (`session.end` with `reason === 'clear'` resets the counters). In omp, detect it by counting `reset_boundary` entries: at `agent_start`, scan `ctx.sessionManager.getBranch()` (or `getEntries()`) for `entry.type === "reset_boundary"` and compare against the last seen entry id. `ResetBoundaryEntry` is a member of the `SessionEntry` union (omp:cod/src/session/session-entries.ts:198-201, 338-354). [INFERENCE: that `getBranch()` returns it unfiltered was not run; a scratch omp session would confirm.]
- `getUsageStatistics()` is cumulative across the whole session file, including entries before `/clear` and, after `/fork`, the inherited history. So `spent` and tokens must be computed as `stats - baseline`, where the baseline is read at the Task start. `resetInheritedCost` exists but only the `/tan` and subagent forks pass it (omp:cod/src/session/session-manager.ts:4155-4179; modes/controllers/tan-command-controller.ts:139; task/executor.ts:4595), not `/fork`.
- `/resume` keeps the same session id and header `timestamp`, so upstream's `taskKey(session, startedAt)` and `resume(b, csv, key)` find the existing CSV row. `/new`, `/fork` and `/branch` mint a new session id (`#syncAgentSessionId`, agent-session.ts:11245, 11408, 13431), so they get a new key.
- `/branch` copies only the root-to-leaf path into a new file (`createBranchedSession`), so totals drop to that path's cost; `/fork` (no id) copies all entries (`sessionManager.fork()`), so totals carry over.

## 6. Session id and model id

- Session id: `ctx.sessionManager.getSessionId()` (omp:cod/src/session/session-manager.ts:3205; also `ExtensionContext.sessionManager`, types.ts:696). Session file: `getSessionFile()` (may be undefined for in-memory sessions).
- Model id: `ctx.model?.id` (types.ts:702; `Model.id`, omp:pi-catalog/src/types.ts:1555-1556) is the *current* model; the model that answered is `AssistantMessage.model` / `.provider` (pi-ai types.ts:1280-1281). `upstreamModel` is set when a router reports a different concrete model (pi-ai types.ts:1302) [use only if the ledger should show the serving model].
- Cost semantics: `cost.total` is priced locally from the model's per-million rates (`calculateUsageCost`, omp:pi-catalog/src/models.ts:160-184), not a provider-reported invoice. Subscription or OAuth sessions still get a list-price number. This feeds the map's "Cost semantics in the shared Ledger" item.

## 7. `hooks/band/metrics.ts`: which exports are pure and importable

### Is the TypeScript shipped, and does it import under Bun?

- Yes. `package.json#files` lists `hooks/` (upstream:package.json `files`), so `hooks/band/{metrics.ts,board.ts,logo.ts,register.tsx,types.d.ts}` are in the tarball. Verified: `ls node_modules/@dietrichgebert/ponytail/hooks/band` in the scratch install shows all five.
- `exports` is `{".": "./.opencode/plugins/ponytail.mjs", "./plugin": "./.opencode/plugins/ponytail.mjs"}`. Under Bun 1.4.4:
  - `import("@dietrichgebert/ponytail/hooks/band/metrics")` and `.../metrics.ts`: **FAIL** (`Cannot find package '@dietrichgebert/ponytail'`).
  - `import("@dietrichgebert/ponytail/package.json")` and bare `import("@dietrichgebert/ponytail")`: OK.
  - **Working route:** `createRequire(import.meta.url).resolve("@dietrichgebert/ponytail/package.json")` -> `path.dirname` -> `await import(pathToFileURL(join(root, "hooks/band/metrics.ts")).href)`. Bun transpiles the `.ts` in `node_modules`. Probe scripts: `%TEMP%/pt-r02-scratch/probe2.ts`, `probe3.ts`.
- A static relative import (`../node_modules/@dietrichgebert/ponytail/hooks/...`) would depend on the install layout [INFERENCE: omp may hoist or nest the dependency]. The `createRequire` + dynamic import route does not. Ticket 01 owns the extension import route; ticket 08 should use the same helper.
- `metrics.ts` has a runtime import of `./board` (`duration`, `elapsed`, `fmtTokens`, `parseCsv`) and `board.ts` imports `./logo`. `import type ... './types'` is erased. No `claude-code` import, no `$`, no `fs`, no `process`. Only `register.tsx` imports `claude-code` (register.tsx:1) and uses JSX, so **never import `register.tsx`**. `types.d.ts:30-34` contains `declare module 'claude-code'`: harmless for Bun at runtime; under `tsc` it only matters if the `.d.ts` is type-checked (use `skipLibCheck` or declare our own `Band` type) [INFERENCE: not run].

### Smoke-run

`bun smoke.ts` in the scratch project imported `metrics.ts` and ran `snapshot`, `markdown`, `upsertCsv`, `resume`, `percent`, `isTestCommand`, `testCounts`, `defsIn`, `callsIn`, `webhookRequest`, `addTokens`: all returned the expected values (e.g. `snapshot` key `abcdef12-1793869200000`, CSV row with the 16 header columns, `percent(2,1) = 67`, `percent(1,1) = undefined`, `webhookRequest("http://example.com/x", ...)` -> `{refused: "webhook needs https"}`).
Actual export list at runtime: `CSV_HEADER, GREP_DEFS, MODEL_PATTERN, NO_TOKENS, TITLE_RECORD, addTokens, addedLines, callsIn, csvRow, defsIn, duration, elapsed, fmtTokens, hits, inProject, isCode, isSource, isTestCommand, mainModel, markdown, metricsSvg, parseDefs, percent, resume, sessionTitle, snapshot, stamp, taskKey, testCounts, testsLabel, totalTokens, upsertCsv, webhookRequest` (plus type-only `Snapshot`, `Hit`, `Col`, `WebhookRequest`).

### Classification (upstream:hooks/band/metrics.ts)

All exports are pure (no I/O, no Claude SDK). The split that matters is "usable as-is in omp" vs "Claude-specific input":

| Export | Pure? | Use in pi-ponytail |
|---|---|---|
| `snapshot(b, startedAt)`, `markdown(s)`, `upsertCsv(existing, s)`, `csvRow`, `CSV_HEADER`, `taskKey`, `resume(b, csv, key)`, `percent`, `testsLabel`, `stamp`, `totalTokens`, `NO_TOKENS` | pure | **As-is.** Ledger and Copy-as-Markdown. `resume` also uses `parseCsv` from board.ts. |
| `webhookRequest(url, token, sendNames, row)` | pure | **As-is.** It lives here (metrics.ts:296-311), not in `register.tsx` (answers ticket 05). It refuses unparsable URLs (`webhook URL is not a URL`) and anything that is not `https:` unless `http:` on hostname `localhost`, `127.0.0.1` or `[::1]` (`webhook needs https`). It sets `content-type: application/json` and `authorization: Bearer <token>` when the token is non-empty. Body is `JSON.stringify(row)` with `name` blanked to `""` when `sendNames` is false. |
| `defsIn`, `callsIn`, `addedLines`, `parseDefs`, `hits`, `isCode`, `isSource`, `inProject`, `GREP_DEFS` | pure | **As-is.** Reuse and Created detection; `parseDefs` takes `git grep` stdout. |
| `isTestCommand`, `testCounts` | pure | **As-is.** Input is `bash` `input.command` and the text of `content`. |
| `addTokens(t, u)` | pure | Takes Claude-shaped `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`. Adapt omp's `Usage` (`input/output/cacheRead/cacheWrite`) before calling, or skip it and assign `getUsageStatistics()` fields directly. |
| `duration`, `elapsed`, `fmtTokens` (re-exported from board.ts) | pure | **As-is.** ANSI/TSP text formatting. |
| `metricsSvg(cols, turnCosts, width)`, `Col` | pure | Not needed: SVG is for Claude's desktop surface. A TSP `Image`/chart is ticket 07's call. |
| `mainModel(grepOut)`, `MODEL_PATTERN`, `sessionTitle(jsonl)`, `TITLE_RECORD` | pure but **Claude-transcript-specific** | Not usable: they parse Claude transcript lines (`"model":"claude-…"`, `"type":"custom-title"`). Replace with `AssistantMessage.model` counting and `getSessionName()`. (`mainModel` also hard-codes a `claude-` prefix.) |
| `Snapshot`, `Band`, `Tokens`, `Tests` types | types | `Band`/`Tokens`/`Tests` are in `types.d.ts`; only the type shape is needed. |

**Depends on the Claude SDK:** only `hooks/band/register.tsx` (imports `atom, read, update` from `claude-code`, uses `$.session/$.fs/$.process/$.http/$.ui`, JSX) and the ambient `declare module 'claude-code'` in `types.d.ts`. Not in `metrics.ts`. Two helpers pi-ponytail must reimplement because they are private to `register.tsx`:
- `ledgerDir`: `${XDG_CONFIG_HOME ?? `${HOME ?? USERPROFILE}/.config`}/ponytail/band` (register.tsx:146-150).
- `ledgerFile(dir, project)`: `${dir}/${project.replace(/[^\w.-]/g, '_')}.csv` (register.tsx:152).
Also `board.ts` exports `parseCsv` and `tasksFrom`; the Board itself stays out of scope.

## 8. Event wiring summary for the Band (for tickets 06, 07)

1. `session_start`, `session_switch`, `session_branch`: (re)start a Task: read `sessionId`, `header.timestamp`, project, level (`resolveSessionMode`), baseline `getUsageStatistics()`, and `known = parseDefs(git grep ...)`. Gate on `ctx.agent.kind === "main"`.
2. `input` / `before_agent_start`: set `name` from the first prompt if `getSessionName()` is empty. Detect `/clear` here via `reset_boundary` entries.
3. `agent_start`: stamp time and cost baseline for `turnCosts`.
4. `message_end` (assistant): count `message.model`.
5. `tool_call` (`write`): stash `before` by `toolCallId`. `tool_result`: update `tests` for `bash`; update `reused/created/removed` for `edit` (from `details`) and `write` (from stash plus `input.content`).
6. `agent_end` with `willContinue !== true`: `turns++`, `busyMs`, `spent`, tokens, `turnCosts`, name; compute `openCallers`; upsert the CSV row with `snapshot` and `upsertCsv`; fire `webhookRequest`.
7. `session_shutdown`: optionally flush.
