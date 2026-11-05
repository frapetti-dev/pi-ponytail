# Research: injecting the Ruleset into `task` subagents (omp 18.13.2)

Ticket: `../issues/03-subagent-injection.md`.

Sources used:
- omp 18.13.2 source, abbreviated `OMP/` = `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/`.
- Upstream ponytail at commit `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846`, a full clone in the OS temp dir (`%TEMP%/ponytail-r03`), abbreviated `UP/`.
- One Bun experiment (last section).

## Short answer

1. **Yes, subagents load the parent's extensions, and `before_agent_start` fires in them.** The parent hands its already-imported extension factories to the child session. The child rebinds them to its own `ExtensionAPI`, fires `session_start`, and fires `before_agent_start` on the assignment prompt.
2. **Upstream's composed extension does inject a Ruleset into subagents, but it does so wrongly.**
   - It always uses the default Level, ignoring the parent's current Level, including `off`.
   - It cannot honour `PONYTAIL_SUBAGENT_MATCHER`.
   - It would also inject into `/tan` clones and other `sub` agents.
3. **The hook is `before_agent_start`, run inside the subagent's own extension instance.** The event carries no agent type. The handler's context does: `ctx.agent` (`ExtensionAgentIdentity`: `kind`, `id`, `name` = lowercased agent definition name, `depth`, `parentId`). `ctx.agent.name` is what `PONYTAIL_SUBAGENT_MATCHER` is tested against.
4. **Recommendation** (details under "Recommendation" below):
   - Compose upstream behind a thin proxy that skips upstream's own `before_agent_start` handler when `ctx.agent.kind === "sub"`.
   - Add one pi-ponytail `before_agent_start` handler that decides Level and matcher for subagents and returns `{ systemPrompt: [...event.systemPrompt, instructions] }`.
   - Keep the parent's Level in a module-level map keyed by agent id, so subagents can inherit it.

## 1. Do subagents load plugin extensions? Yes, by rebinding the parent's prepared factories

- `buildExecutorOptions` forwards the parent's imported extensions to every child: `preloadedPreparedExtensions: session.preparedExtensions` (`OMP/task/structured-subagent.ts:667-668`). The comment at 663-666 explains that "preloaded paths only avoid re-scanning/reusing parent-bound extension instances".
- `runSubagent` passes them to `createAgentSession`: `preloadedPreparedExtensions: options.preloadedPreparedExtensions` (`OMP/task/executor.ts:4722-4725`).
- In `createAgentSession`, branch `restrictToolNames || options.preloadedPreparedExtensions` calls `bindPreparedExtensions(preparedExtensions, cwd, eventBus)` (`OMP/sdk.ts:2811-2825`). The comment there reads "Restricted children retain parent hooks, not ambient discovery". This branch runs even for restricted children (plan mode, seance forks), so extensions are not dropped even when tools are restricted.
- `bindExtension` builds a new `ConcreteExtensionAPI` and re-runs the factory for the child (`OMP/extensibility/extensions/loader.ts:439-459`, `501-530`).
  - The module is not re-evaluated. Module-level variables in pi-ponytail and in upstream's `index.js` are shared between parent and children. Every closure inside the factory, such as upstream's `currentMode`, is per session.
- Plugin extensions are in `preparedExtensions`. They go through the same `loadExtensions` as every other discovered extension (`OMP/extensibility/extensions/loader.ts:486-494`), and `sdk.ts:4859` stores `extensionsResult.preparedExtensions` on the session.
- `ExtensionRunner` is built for the child with an agent identity (`OMP/sdk.ts:3518-3536`):
  - `kind: isSubagentSession ? "sub" : "main"`
  - `id: resolvedAgentId`
  - `name: resolvedAgentName`
  - `depth: taskDepth`
  - `parentId: options.parentAgentId`
- The child then runs `initializeExtensions(session, …)`, which wires the runner and emits `session_start` (`OMP/task/executor.ts:4965-4975`, `OMP/modes/runtime-init.ts:56-58`, `212`). The child's mode is the default `"print"` and `hasUI` is false (`OMP/task/executor.ts:4726`).
  - `ctx.ui` calls such as `setStatus` and `notify` reach a non-UI context. [INFERENCE] they are no-ops.
  - Upstream's `syncStatus` and `notify("Ponytail loaded…")` are therefore harmless in children.

## 2. Does `before_agent_start` fire in subagents? Yes, on the assignment prompt

- The child's task assignment is sent with `session.prompt(text, { runCommands: false, … })` (`OMP/task/executor.ts:2490-2499`).
- `#prepareAgentStart` runs `this.#extensionRunner?.emitBeforeAgentStart(prompt, images, basePreparation.systemPrompt)` (`OMP/session/agent-session.ts:8625-8631`).
  - There is no agent-kind gate in that path.
  - `#agentKind` is only used for auto-prewalk (`agent-session.ts:8582-8587`).
- The event shape is `{ type, reason: "prompt"|"revive", prompt, images?, systemPrompt: string[] }` (`OMP/extensibility/extensions/types.ts:1091-1099`).
  - **There is no agent type on the event.**
  - There is no `systemPromptOptions` either, so upstream's `sections` branch is dead on omp.
- A returned `systemPrompt` is a per-turn replacement that lasts "for the next request and its continuations" (`types.ts:1641-1644`; `OMP/session/agent-session.ts:8688-8689`).
  - It is cleared in the `finally` after the turn (`agent-session.ts:8981-8983`).
  - Handlers chain: each handler sees the previous handler's `systemPrompt` (`OMP/extensibility/extensions/runner.ts:2261-2293`).
  - Within one extension, handlers run in registration order.
- **Caveat: revived or parked subagents.** Wake turns of a revived subagent are agent-initiated and "skip the hook". The core replays `before_agent_start` once with `reason: "revive"` and an empty prompt, and **discards the result** (`OMP/task/executor.ts:4111-4119`; type doc at `types.ts:1086-1090`). Any later turn without a user prompt therefore runs without the injected Ruleset.
  - The first turn is covered, which is the normal one-shot `task` case.
  - The gap is limited to revived and kept-alive subagents' follow-up turns. [INFERENCE] it is minor, and the spec should note it.

## 3. What upstream's composed extension does in a subagent (`UP/pi-extension/index.js`)

- `ponytailExtension(pi)` starts with `currentMode = DEFAULT_MODE` (`index.js:74`).
- `session_start` calls `restoreSessionMode(ctx)`, which sets `currentMode = resolveSessionMode(ctx.sessionManager.getBranch(), configuredDefaultMode)` (`index.js:197-210`).
- A subagent's `SessionManager` is a fresh `SessionManager.open(sessionFile…)` or `SessionManager.inMemory(cwd)` (`OMP/task/executor.ts:4598-4604`). `forkFrom` is used only for seance consults, which pass `preparedSession` (`executor.ts:4586-4597`).
  - A fresh session contains no `ponytail-mode` entry.
  - So `currentMode` becomes `getDefaultMode()`: env `PONYTAIL_DEFAULT_MODE`, then `config.json`, then `full` (`UP/hooks/ponytail-config.js:80-90`, `17-18`).
- The `before_agent_start` handler (`index.js:230-253`) then does the following.
  - If `currentMode` is `off`, it returns nothing.
  - Otherwise it returns `{ systemPrompt: [...event.systemPrompt, getPonytailInstructions(currentMode)] }`.
  - That is the array path: `Array.isArray(event.systemPrompt)` at line 246 matches omp, and the `sections` branch at 240 is never taken.
- Consequences for subagents:
  - A subagent gets the default Level, not the parent's. If the user ran `/ponytail off` or `/ponytail ultra`, the child still gets `full`.
  - There is no `PONYTAIL_SUBAGENT_MATCHER` support; a grep of `UP/pi-extension/` finds no reference to it.
  - `/tan` clones, which are `kind: "sub"` with name `"sub"`, get the Ruleset too.
  - The `input` handler (`index.js:188-195`) would turn a subagent's own mode `off` if its task text is exactly "stop ponytail" or "normal mode". This is cosmetic.

## 4. How upstream handles subagents elsewhere (Claude Code plugin)

- `hooks/ponytail-subagent.js` is the `SubagentStart` hook, wired in `UP/hooks/claude-codex-hooks.json:16-21`. Its header (`ponytail-subagent.js:1-11`) says SessionStart context never reaches subagents (issue #252), so it injects the same Ruleset into each one.
- Level source: `readMode()` reads the per-project `.ponytail-active` flag file (`UP/hooks/ponytail-runtime.js:51-80`). Subagents therefore follow the **live** Level. Absent flag or `off` means no injection (`ponytail-subagent.js:17-22`).
- Matcher (`ponytail-subagent.js:8-11`, `32-83`):
  - Env `PONYTAIL_SUBAGENT_MATCHER`, compiled with `new RegExp(src, 'i')`: unanchored and case-insensitive.
  - It is tested against `agent_type` from the hook's stdin JSON.
  - It runs under `vm.runInNewContext('re.test(s)', …, { timeout: 100 })` to bound catastrophic backtracking (#658).
  - Fail-open on every doubt: invalid regex, unparseable or missing `agent_type`, or a timeout all mean inject.
  - Only a definite mismatch skips injection.
- Documented in `UP/INSTALL.md:196`: "plugin agent types look like `plugin:name`".
- Qoder uses `PreToolUse` with a `task|Task` matcher instead (`UP/INSTALL.md:113`). Cursor and CodeBuddy cannot inject into subagents (`UP/docs/agent-portability.md:14, 27`).

## 5. Available omp hooks and what each exposes

| Hook / API | Where it runs | Can add to subagent system prompt? | Agent type available? |
|---|---|---|---|
| `before_agent_start` in the child's extension instance | child session; fires on assignment prompt | **Yes**: return `{ systemPrompt: string[] }` (`types.ts:1641-1644`) | `ctx.agent.name` and `ctx.agent.kind`; none on the event (`types.ts:1091-1099`, `680-746`) |
| `before_subagent_spawn` in the parent's extension instance | parent session, before the child resolves its model (`OMP/task/structured-subagent.ts:486-510`) | **No**. The result type allows only `model`, `note` and `block` (`types.ts:1647-1650`; `runner.ts:2305-2338`) | `event.agent` is the definition name; also `invocationKind: "task"\|"eval"`, `modelRole`, `patterns`, `spawnKey?` (`types.ts:1101-1113`) |
| `ctx.getSystemPrompt()` | any handler (`types.ts:755-756`) | read only | n/a |
| Subagent system prompt template (`subagentSystemPromptTemplate`) | core | not extensible | n/a |

- `ExtensionAgentIdentity` (`types.ts:523-546`):
  - `kind`: `"main"` or `"sub"`. The doc says to use this, not `depth`: `/tan` clones are subagents at depth 0.
  - `id`: the registry id, such as `"Main"` or `"0-Explore"`.
  - `name`: lowercased agent definition name (`"task"`, `"explore"`, …), or `"sub"` for `/tan` clones. The lowercasing is at `sdk.ts:2223`, fed from `agentName: agent.name` at `executor.ts:4740-4741`.
  - `depth`.
  - `parentId?`: the spawning agent's registry id. It is set only when the child has a `parentAgentId` (`sdk.ts:3533`).
- The description lists `before_subagent_spawn` events as emitted in the parent only. The child's own runner fires `before_agent_start`.
- No dedicated subagent-start event exists in `ExtensionAPI.on` (`grep` of `types.ts` finds only `before_subagent_spawn`).

## 6. Recommendation

**Use `before_agent_start` with `ctx.agent`.** It is the only hook that can add text to the subagent's prompt. Do not use `before_subagent_spawn`; it cannot inject.

Design for the spec:

1. **Suppress upstream's subagent injection.** Compose upstream behind a wrapper.
   - Call `ponytailExtension({ ...pi, on: wrappedOn })` in effect: for event `"before_agent_start"`, wrap upstream's handler as `(event, ctx) => ctx.agent.kind === "sub" ? undefined : handler(event, ctx)`.
   - Forward every other event unchanged, preserving `this` semantics on `pi`. [INFERENCE] a `Proxy` is probably simplest.
   - This relies on `ctx.agent`, which is documented on `ExtensionContext` (`types.ts:745-746`).
   - Alternative that needs no proxy: seed the child's session with `pi.appendEntry("ponytail-mode", { mode })` from a `session_start` handler registered **before** calling upstream's factory, so upstream's own restore picks it up.
     - It persists a stale entry into the subagent's session file.
     - It still cannot express "matcher says skip" except as `mode: "off"`.
     - It depends on upstream's entry shape.
     - The proxy is less stateful, so prefer it.
   - Coordinate with ticket 01. Its Level-read and Level-switch design may already wrap `pi` this way.
2. **pi-ponytail's subagent handler.** Register `pi.on("before_agent_start", …)`:
   - Do nothing unless `ctx.agent.kind === "sub"`.
   - If `PONYTAIL_SUBAGENT_MATCHER` is set, compile it with `new RegExp(src, "i")`. Test `ctx.agent.name` under `vm.runInNewContext("re.test(s)", { re, s }, { timeout: 100 })`.
     - Skip only on a definite non-match.
     - Fail open on a bad regex, a timeout, or an empty name, exactly as upstream does.
   - Level = the parent's live Level, else the default.
   - If the Level is `off`, return nothing. Otherwise return `{ systemPrompt: [...event.systemPrompt, getPonytailInstructions(level)] }`.
     - `getPonytailInstructions` is imported from the npm package's `hooks/ponytail-instructions.js`, as upstream does.
3. **Inherit the parent's live Level.** The module is shared across parent and children, so keep a module-level `Map<agentId, level>`.
   - The main agent records its Level on `session_start`, `session_switch`, `session_branch`, `session_tree` and `before_agent_start`, as `resolveSessionMode(ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? [], getDefaultMode())`.
   - `resolveSessionMode` is exported by upstream's `index.js` (`UP/pi-extension/index.js:32`).
   - A subagent looks up `levels.get(ctx.agent.parentId)`, and falls back to `getDefaultMode()` when absent.
   - It also stores its own entry under `ctx.agent.id`, so nested subagents inherit at depth 2 and beyond.
   - Clear entries on `session_shutdown`. [INFERENCE] the exact event name and cleanup point are for the spec to confirm.
   - Ticket 01 owns exactly how our code reads the parent's Level. This map should reuse that answer.
4. **Document the known gaps** in the spec:
   - Kept-alive or revived subagents' later, non-prompt turns do not get the Ruleset (section 2 caveat).
   - `PONYTAIL_SUBAGENT_MATCHER` is tested against the lowercased agent definition name (`explore`, `task`, `reviewer`, …). Claude Code tests `agent_type`, which may be `plugin:name`. With an `i` regex this only matters for patterns that depend on the exact casing of the name or on a `plugin:` prefix.
   - `/tan` clones have the name `"sub"`. The matcher sees `sub`.
   - Whether omp should use the same env var name: yes, keep `PONYTAIL_SUBAGENT_MATCHER` for parity with Claude Code. [INFERENCE] it could later also become an `omp.settings` entry, which is not a locked decision.

## 7. Bun check: `vm` timeout

I ran the ReDoS pattern `/(a+)+$/i` against `"a"×40 + "b"` through `vm.runInNewContext("re.test(s)", …, { timeout: 100 })` under Bun.
- It threw `ERR_SCRIPT_EXECUTION_TIMEOUT`, but only after about 686 ms. The timeout is honoured loosely, not at 100 ms.
- A normal match (`/explore|task/i` against `"Explore"`) returns `true`.
- So upstream's vm-guard pattern works under Bun, with a coarser bound. Treat any throw as "fail open".

## Things that affect other tickets

- **Ticket 01**: any proxy over `pi.on` and the way the parent's Level is read must be shared with this design. Subagent rebinding means our factory runs once per subagent session as well, so it must be cheap and side-effect free. For example the band widget, ledger and map must not start in `ctx.agent.kind === "sub"` sessions.
- **Tickets 02, 06 and 07**: per-subagent sessions fire the same events (`turn_end`, `session_start`). Band and Ledger handlers must skip `ctx.agent.kind === "sub"`, or they will create phantom Tasks.
- **Ticket 05**: the codebase map goes into the parent's prompt only. Subagents should not get it re-injected unless the spec chooses so.
- **Ticket 08**: no packaging impact.
