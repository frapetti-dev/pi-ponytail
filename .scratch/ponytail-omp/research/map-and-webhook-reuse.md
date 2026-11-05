# Research: codebase map and webhook reuse (ticket 05)

## Sources used

- Upstream `DietrichGebert/ponytail`: `git clone` into `%TEMP%\pp05\up`, checked out at `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` (HEAD `96608e0 docs: add PhotoReunion ...`, package.json 5.3.3). Cited below as `up/<path>`.
- npm package: `bun add @dietrichgebert/ponytail@5.3.3` in scratch project `%TEMP%\pp05\proj` (Bun 1.4.4). All importability results are from the installed npm copy (`node_modules/@dietrichgebert/ponytail`), not the git clone.
- omp 18.13.2 source: `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/...` (cited as `omp/<path>` relative to `src/`).
- No `.omp` directory was read.

---

## A. Codebase map

### A1. Is `buildMap(root)` exported and importable from the npm package?

**Yes, exported; importable only by path, not by package specifier.**

- Export: `up/hooks/ponytail-map.js:109` `module.exports = { buildMap };` (CommonJS, no dependencies besides `fs`, `path`, `child_process`; line 12-14). `buildMap(root = process.cwd())` at line 75. It also has a CLI tail (line 111) that prints the map for `argv[2]`.
- The map module ships in the npm tarball: `package.json` `files` includes `"hooks/"` (`up/package.json`, `files` array), and the installed package contains `hooks/ponytail-map.js`.
- `exports` is only `"."` and `"./plugin"` (both `./.opencode/plugins/ponytail.mjs`) (`up/package.json`).

Scratch check (`%TEMP%\pp05\proj\t.mjs`, run `bun t.mjs <dir>`; ESM project, `bun add @dietrichgebert/ponytail@5.3.3`):

| Route | Result under Bun 1.4.4 |
|---|---|
| `await import("@dietrichgebert/ponytail/hooks/ponytail-map.js")` (deep specifier) | **fails**: `Cannot find package '@dietrichgebert/ponytail' imported from ...t.mjs` (also `require.resolve` of the same specifier fails: `Cannot find module`) |
| `createRequire(import.meta.url).resolve("@dietrichgebert/ponytail")` -> main, then `root = resolve(dirname(main), "..", "..")` (main is `<root>/.opencode/plugins/ponytail.mjs`), then `createRequire(main)(join(root,"hooks","ponytail-map.js"))` | **works**: keys `["buildMap"]` |
| `createRequire(import.meta.url).resolve("@dietrichgebert/ponytail/package.json")` | works under Bun (path returned) although `package.json` is not in `exports` [INFERENCE: Bun is lenient here, Node would throw `ERR_PACKAGE_PATH_NOT_EXPORTED`; do not rely on it - derive root from the `"."` main instead] |
| `await import(pathToFileURL(join(root,"hooks","ponytail-map.js")).href)` | works: `Object.keys` = `["buildMap","default"]`, `typeof buildMap === "function"` |
| `await import(pathToFileURL(join(root,"hooks","band","metrics.ts")).href)` (TypeScript file in `node_modules`) | works; Bun transpiles it; exports: `CSV_HEADER, GREP_DEFS, MODEL_PATTERN, NO_TOKENS, TITLE_RECORD, addTokens, addedLines, callsIn, csvRow, defsIn, duration, elapsed, fmtTokens, hits, inProject, isCode, isSource, isTestCommand, mainModel, markdown, metricsSvg, parseDefs, percent, resume, sessionTitle, snapshot, stamp, taskKey, testCounts, testsLabel, totalTokens, upsertCsv, webhookRequest` |

So the import route for **both** map and webhook is the same: resolve the package root from the `"."` main (`dirname(main)/../..`), then `createRequire(main)(abs path)` for the CJS map or `import(pathToFileURL(abs path))` for the `.ts` module. This is the same file-path pattern ticket 01 evaluates for `pi-extension/index.js`; upstream's own `pi-extension/index.js:1-3,14-15` uses `createRequire(import.meta.url)` + relative `../hooks/*.js`.

`buildMap` output on the upstream clone (git repo, 216 files), run via the npm copy:

```
Codebase map (what already exists; reuse it, read a file only when you need its details):
hooks/band/: duration, elapsed, fmtTokens, LOGO_VIEWBOX, LOGO_PATHS, GREP_DEFS, isCode, isSource, register
./: build_injected_context, rewrite_gateway_command, register
.opencode/plugins/: default
benchmarks/agentic/: ...
pi-extension/: readDefaultMode, readQuietStartup, completePonytailArgs
```

### A2. Runtime cost and failure modes

Algorithm (`up/hooks/ponytail-map.js`):

1. `listFiles(root)` (37-60): `git ls-files` in `root` with `timeout: 3000`, `maxBuffer: 64 MiB`, stderr ignored; first `MAX_FILES*5` = 20 000 lines. If git throws (not a repo, git missing, **timeout**, buffer) or returns zero lines (untracked folder inside a parent repo), it falls back to a synchronous directory walk: depth <= 6, skips dot-names and `SKIP_DIR`, stops at 20 000 entries. **The walk has no time limit.**
2. Filter (76-79): `SAFE_PATH` (`/^[\w.@+$()[\]\/-]+$/`, keeps hostile file names and newlines out of the prompt), `SRC` extension set, `SKIP_DIR`, `SKIP_FILE` (tests, `.d.ts`, `.min`, `.gen`); cap `MAX_FILES = 4000`; sort shared-looking paths first (`SHARED` regex), then alphabetical.
3. For each file (82-92): `lstatSync` must be a regular file (symlinks skipped); `readFileSync(...).slice(0, 65536)`; regex definitions per language. Files unreadable -> skipped (try/catch).
4. Output (93-106): one line per directory, `<dir>/: name, name, ...`, <=30 names, 3 names per file (1 per file when the folder has >8 files). Budget check `used + line.length > BUDGET` skips whole lines (counted in the `(N more folders not listed)` footer); the header line is not counted. No lines -> returns `''`.

Measured here (Windows, Bun 1.4.4; `%TEMP%\pp05\proj\t2.mjs`, in-process `buildMap`):

| Root | Time | Output |
|---|---|---|
| upstream clone, git repo, 216 files | 289 ms in-process; 302-472 ms as `bun ponytail-map.js <root>` child | 582 chars |
| `@oh-my-pi/pi-coding-agent` dir (not a git repo -> walk fallback) | **2 529 ms** | 2 117 chars |
| `C:/Users/f.rapetti/git/pi-ponytail` (no source) | 118 ms | `''` (0 chars) |
| nonexistent root | 5 ms | **throws** `ENOENT: scandir` (the walk is outside any try/catch, `ponytail-map.js:46-59`) |

Failure modes, from code and the runs above:

- **"3 s timeout"** is two different things. (a) `git ls-files` has its own 3000 ms timeout (`ponytail-map.js:42`); on expiry it is swallowed and the unbounded walk runs instead. (b) `up/hooks/ponytail-activate.js:66-71` runs the whole map as a child process `execFileSync(process.execPath, [ponytail-map.js], {timeout: 3000, maxBuffer: 64*1024, stdio: [ignore,pipe,ignore]})` and drops the map on any error ("Fail open", comment lines 63-65: "a map slower than 3 s is still dropped; a cached per-repo map would lift that"). That outer timeout is **not** part of `buildMap`; anyone calling `buildMap` in-process gets no timeout at all.
- `buildMap` is **synchronous**: `execFileSync` + `readFileSync` x up to 4 000 files x up to 64 KiB. In-process in omp it blocks the TUI event loop for as long as it runs (0.3 s typical git repo, ~2.5 s measured on a large non-git tree, worse if git times out first, then the walk follows).
- Throws on a nonexistent or unreadable `root` (walk branch only). Needs a try/catch.
- Untracked and gitignored files are invisible in a git repo (`git ls-files` lists tracked only); a brand new project with no commits and no tracked files falls to the walk (that is how it behaved on the empty `pi-ponytail` dir: `''`).
- Regex, not a parser (file header comment, lines 9-10): nested/dynamic definitions missed.
- `process.execPath` as the child runtime (activate hook) is only valid when the host is `node`/`bun`. Under a compiled omp binary `process.execPath` would be the omp executable [INFERENCE; omp has `isCompiledBinary()` paths, e.g. `omp/extensibility/plugins/legacy-pi-compat.ts:21`]. The in-process route avoids that.

### A3. `PONYTAIL_MAP=0` and `PONYTAIL_MAP_CHARS`

- `PONYTAIL_MAP=0` is **not read by the map module**. It is read only in the activation hook (`up/hooks/ponytail-activate.js:66`: `mode !== 'review' && process.env.PONYTAIL_MAP !== '0'`). Verified: `PONYTAIL_MAP=0 bun ponytail-map.js <repo>` still prints the full map. So pi-ponytail must check `process.env.PONYTAIL_MAP !== '0'` itself, plus `level` not `off` (the hook exits before the map when `mode === 'off'`, lines 33-36) and not `review` (`review` is a session-only mode in `up/hooks/ponytail-config.js:17`, `VALID_MODES = ['off','lite','full','ultra','review']`; `RUNTIME_MODES` at :18 has no review).
- `PONYTAIL_MAP_CHARS` (`ponytail-map.js:16`): `const BUDGET = Number(process.env.PONYTAIL_MAP_CHARS || 2000);` evaluated **once at module load**. Measured with `bun ponytail-map.js <repo>` (583 chars default):
  - unset or `''` -> 2000 (empty string is falsy)
  - `200` -> 315 chars, footer `(2 more folders not listed)`
  - `0` -> `'0'` is truthy, `Number('0') = 0`, every line skipped -> output is empty (CLI prints a bare newline). Effectively disables the map.
  - `abc` -> `NaN`; `used + line.length > NaN` is always false, so **no budget at all** (all lines kept; output was the same 583 chars here, would be unbounded on a big repo up to `MAX_FILES` limits).
  - The budget applies per line and excludes the header and footer, so output can be a bit over the number.
- Consequence: if pi-ponytail imports `ponytail-map.js` in-process, `PONYTAIL_MAP_CHARS` is only honoured if it is in the environment before the module is first required (it is a process env var, so a normal user shell export works; a plugin setting could not change it after import without re-importing). The ticket's locked settings (decision 8) do not include a map setting, so this is fine.

### A4. Which omp hook, and how often

Facts from omp 18.13.2:

- `before_agent_start` handlers run once per prompt start in `#prepareAgentStart` (`omp/session/agent-session.ts:8631`: `emitBeforeAgentStart(prompt, images, basePreparation.systemPrompt)`), inside a retry loop (`for attempt < AGENT_START_POLICY_MAX_ATTEMPTS`, line 8625) that re-runs the handlers when the base prompt changed underneath. Also run with `reason: "revive"` for warm-revived subagents (`omp/task/executor.ts:4117-4119`).
- The system-prompt override is **per turn only**: handlers receive `event.systemPrompt` (string array) and may return `{ systemPrompt }`; results chain across handlers in extension order and, within one extension, in registration order (`omp/extensibility/extensions/runner.ts:2249-2303`, specifically `currentSystemPrompt = result.systemPrompt` at 2286-2289; a string is wrapped into `[string]`). The winning array is installed with `setTurnSystemPromptOverride` (`agent-session.ts:8689`) and cleared when no handler returned one (`8690-8692`) and at turn end (`agent-session.ts:8982`; `omp/session/session-tools.ts:393-397,560-564`). **Therefore the map must be returned from every `before_agent_start`, not just once.**
- Handler budget: `EXTENSION_HANDLER_TIMEOUT_MS = 30_000` (`runner.ts:133`, `#runHandlerWithTimeout` at 2273).
- Upstream's composed extension already returns `{ systemPrompt: [...event.systemPrompt, instructions] }` for omp's array prompts (`up/pi-extension/index.js:230-253`, array branch 246-248). Upstream's pi-extension has **no map code** (grep for `map`/`MAP`/`ponytail-map` in `up/pi-extension/index.js` finds only `.map(` calls) so the map is not injected under omp today; only the Claude/Codex/Copilot/Cursor SessionStart hook injects it (`ponytail-activate.js:63-71`; `ponytail-map.js` is required nowhere else in `hooks/`, `pi-extension/`).
- `session_start` is emitted once at startup (`omp/modes/runtime-init.ts:212`), and `session_switch` / `session_branch` fire on /new /resume /fork /branch (upstream relies on exactly that: `up/pi-extension/index.js:212-218`). `ctx.cwd` is on the extension context (`omp/extensibility/extensions/types.ts:694`).

Recommendation (design input for the spec; not built):

1. **Compute once per session**, not per `before_agent_start`: build on `session_start` and recompute on `session_switch` (and `session_branch`) only if `ctx.cwd` changed [INFERENCE: cwd rarely changes there]. Store the string in a closure variable. Reasons: (a) the map is injected into every prompt, so a byte-identical string keeps provider prompt-cache prefixes stable; (b) `before_agent_start` can run several times per prompt (retry loop above) and for subagent revive; (c) the sync cost (0.3-2.5 s) is paid once. Upstream Claude hook is also once per session start (SessionStart), so same semantics. Trade-off: files created mid-session are not in the map (the agent's own edits are already in its context).
2. **Hook**: a `before_agent_start` handler registered by pi-ponytail *after* it calls upstream's default export (so it runs after upstream's handler in the same extension and sees upstream's array). Return `{ systemPrompt: [...event.systemPrompt, mapText] }`. Do not return anything when level is `off` / `review`, `PONYTAIL_MAP === '0'`, or the map is `''`.
3. **Level source**: ticket 01 owns it; upstream exports `resolveSessionMode(entries, fallbackMode)` (`up/pi-extension/index.js:32-45`) and `readDefaultMode`; entries come from `ctx.sessionManager.getBranch()` (restore code at lines 203-218). Note `before_agent_start` has the event/ctx only; deriving the Level there with `resolveSessionMode(ctx.sessionManager.getBranch(), readDefaultMode())` is cheap.
4. **Do not block the UI**: wrap the build in try/catch (it throws on a bad root) and run it deferred (e.g. `setTimeout(..., 0)` from `session_start`, with `before_agent_start` awaiting the same promise if it is not ready) so omp paints first. A truly non-blocking build (child process) needs a runtime that can run the script; upstream's `process.execPath` approach is unsafe under a compiled omp (see A2). Keep the 3 s `git ls-files` guard (built in) and accept the unbounded walk fallback, or skip the map when `git ls-files` fails [decision for the spec].
5. **Main session only**: upstream's subagent hook never adds the map (only `ponytail-activate.js` requires `ponytail-map.js`), so the map handler must not run for subagents. `BeforeAgentStartEvent` has only `type, reason ("prompt"|"revive"), prompt, images, systemPrompt` (`omp/extensibility/extensions/types.ts:1091-1099`): no agent-type field, so detecting a subagent inside this handler is ticket 03's question (`before_subagent_spawn` carries `agent`, `types.ts:1102-1106`, but fires in the parent session).

---

## B. Webhook

### B1. Is `webhookRequest` in a pure module?

**Yes: `up/hooks/band/metrics.ts:299`** (`export function webhookRequest(url, token, sendNames, row)`), header comment line 1: "Pure helpers for the band: no `$`, so the tests call them directly." Its only runtime import is `./board` (`duration, elapsed, fmtTokens, parseCsv`, line 3) which imports `./logo` (`up/hooks/band/board.ts:4`); type-only import of `./types`. No Claude SDK dependency. `register.tsx` (Claude SDK, `$` engine) only **calls** it (`register.tsx:170`) and does the `$.http.fetch` itself. Importable from the npm package under Bun: yes, see A1 table (file-URL import of `hooks/band/metrics.ts` works; all calls below were executed from the installed npm copy). The package ships `hooks/` whole (`package.json#files`), including `hooks/band/*.ts`, `board.ts`, `logo.ts`.

Type: `WebhookRequest = { url: string; init: { method: 'POST'; headers: Record<string,string>; body: string } }` (`metrics.ts:296`). Upstream's own test: `up/tests/band.test.tsx:116-131`.

### B2. Exact rules and payload

Code (`metrics.ts:298-311`, verbatim):

```ts
// The token travels only over HTTPS; plain http is allowed for a board on this machine.
export function webhookRequest(url, token, sendNames, row) {
  let target: URL
  try { target = new URL(url) } catch { return { refused: 'webhook URL is not a URL' } }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && local)) return { refused: 'webhook needs https' }
  const headers = { 'content-type': 'application/json' }
  if (token !== '') headers.authorization = `Bearer ${token}`
  return { url: target.href, init: { method: 'POST', headers, body: JSON.stringify(sendNames ? row : { ...row, name: '' }) } }
}
```

Rules:

1. `new URL(url)` fails -> `{ refused: 'webhook URL is not a URL' }`.
2. Allowed: `https:` any host; `http:` only when `hostname` (WHATWG-normalised) is exactly `localhost`, `127.0.0.1` or `[::1]`. Anything else (including `ftp:`, `http:` remote) -> `{ refused: 'webhook needs https' }`.
3. Empty token -> no `authorization` header (not an empty Bearer). Token is sent only if non-empty, and only reaches https or the three local hosts.
4. Body: `JSON.stringify(row)` where `row` is the `Snapshot`; with `sendNames === false` the same object with `name: ''` (key kept, value blank).
5. No redirect/timeout handling inside the function (the caller does `fetch`).

Executed against the npm copy (Bun 1.4.4):

| URL | Result |
|---|---|
| `https://b.example.com/t` | ok, `Bearer tok`, name sent |
| `http://b.example.com/t` | `{refused:'webhook needs https'}` |
| `http://[::1]:4711/t`, sendNames=false | ok, `name:""` |
| `http://localhost:1/t`, token `''` | ok, no `authorization` header |
| `nope`, `//x`, `https://` | `{refused:'webhook URL is not a URL'}` |
| `ftp://localhost/t`, `http://LOCALHOST.evil.com/t`, `http://127.0.0.2/t`, `http://0.0.0.0/t`, `http://localhost.:1/t` | `{refused:'webhook needs https'}` |
| `http://LOCALHOST:1/t`, `http://[0:0:0:0:0:0:0:1]:1/t`, `http://127.1/t` | ok (URL normalises to `localhost`, `[::1]`, `127.0.0.1`) |
| `https://user:pw@b.example.com/t?x=1#f` | ok; `url` keeps `user:pw@`, query and fragment (no stripping) |

Payload = `Snapshot` (`metrics.ts:188-206`), keys in this order, example from `snapshot(...)` run here:

```json
{"key":"abcdef01-1793880000000","started":"2026-11-05 13:00","project":"p","name":"My task",
 "session":"abcdef0123456789","level":"full","model":"m","cost":1.2345,"lastTurn":0.1,"turns":2,
 "agentMs":60000,"tokens":{"input":1,"output":2,"cacheRead":3,"cacheWrite":4},
 "reuse":33,"reused":1,"created":2,"callersOpen":0,"tests":"not run"}
```

Notes: `started` is formatted by `stamp()` in the **local time zone** (input `Date.UTC(2026,10,5,12,0)` printed `13:00` on this UTC+1 machine); `reuse` is `null` when fewer than 3 definitions (`percent`, metrics.ts:293); `tests` is the label string.

How upstream drives it (`up/hooks/band/register.tsx:154-181`): after every turn, `url = options.webhookUrl.trim()`; skip if `''`; `token = options.webhookToken.trim()` or `''`; `sendNames = options.sendNames !== false`; if refused -> `$.ui.status('ponytail band: <refused>')` and stop; else **not awaited** `fetch(request.url, request.init)` then status `ponytail band: webhook answered <status>` if `!r.ok`, `ponytail band: webhook unreachable` on throw (status cleared on ok). Upstream's manifest declares the same three keys: `up/.claude-plugin/plugin.json:21-38` (`webhookUrl` string default `""`, `webhookToken` string `sensitive: true`, `sendNames` boolean default `true`), so pi-ponytail's `omp.settings` mirror them (decision 8).

**Recommendation: import and reuse `webhookRequest` from `hooks/band/metrics.ts`** (same route as `snapshot`/`upsertCsv` the band already needs per ticket 02) rather than re-implementing; matching the rules by hand is unnecessary.

### B3. How an omp extension reads `omp.settings` (incl. secret and `env`)

Findings (omp 18.13.2):

- **No API on `pi`/ExtensionAPI/ExtensionContext for plugin settings.** Searching `omp/extensibility/extensions/types.ts` for settings finds only model/trust items (`isProjectTrusted`, lines 748-754); `pi.pi` is the root export namespace (`typeof PiCodingAgent`, `types.ts:1720-1721`, `loader.ts:192,452`) and `omp/index.ts` does not re-export `extensibility/plugins` (grep of `index.ts` for `plugins` = no match; root re-exports are listed at lines 5-80).
- **`getPluginSettings(pluginName, cwd)` exists** at `omp/extensibility/plugins/loader.ts:489-497`: returns `{ ...runtimeLock.settings[pluginName], ...projectOverrides.settings[pluginName] }`. It reads the user-scope plugins lockfile (`getPluginsLockfile()`, `loadRuntimeConfig`, lines 56-64) and project overrides from `plugin-overrides.json` found via `getConfigDirPaths(..., {user:false, cwd})` (`loader.ts:69-86`); reads files on every call (no cache), so a later `omp plugin config set` is seen by the next call.
- It is reachable via the package exports map: `"./extensibility/plugins"` -> `src/extensibility/plugins/index.ts` (`export * from "./loader"`, `index.ts:5`) and `"./extensibility/plugins/*"` (`omp/package.json:278-285`). A plugin's `@oh-my-pi/pi-coding-agent/...` specifiers are remapped by the host shim to the host's own copy (`omp/extensibility/plugins/legacy-pi-compat.ts:801-857`, filter `LEGACY_PI_SPECIFIER_FILTER` at 857, resolver 2781-2845), so `import { getPluginSettings } from "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader"` should resolve [INFERENCE: not executed here; omp was not run; the compiled-binary path uses `/$bunfs` bundled registry and subpath coverage there is unverified]. This is the only in-process route found; nothing in the `pi.pi` namespace exposes it.
- **Values stored**: `omp plugin config set <plugin> <key> <value>` parses by schema type and validates, then `manager.setPluginSetting` writes into the lockfile `settings[name][key]` (`omp/cli/plugin-cli.ts:1015-1040`; `manager.ts:1028-1035`). The lockfile is written 0600 specifically because `secret` settings are credentials (`omp/extensibility/plugins/runtime-config.ts:16-20`), i.e. **secret values are stored in plain text in the lockfile**; `secret: true` only masks display (`plugin-cli.ts:984,1009`).
- **`env` and `default` are NOT applied by the read API.** `PluginSettingBase` documents `env?: string` "Environment variable to use as fallback value" and `secret?: boolean` "mask value in UI and logs" (`omp/extensibility/plugins/types.ts:57-66`), but a search for `.env` use of schema entries finds only the display line `console.log(... env: ${s.env})` in `plugin-cli.ts:989-991`; `getPluginSettings` (loader.ts:489) and `PluginManager.getPluginSettings` (manager.ts:1015-1023) return stored values only. Defaults are applied only by the CLI at display time (`settings[key] ?? schema.default`, `plugin-cli.ts:1004`, TUI overlay line 219 in `pi-tui` plugin-settings). Therefore pi-ponytail must do the resolution itself:
  - `webhookUrl = (stored.webhookUrl ?? '').trim()`
  - `webhookToken = (stored.webhookToken ?? process.env.PONYTAIL_WEBHOOK_TOKEN ?? '').trim()`
  - `sendNames = stored.sendNames !== false` (matches upstream `options.sendNames !== false`, and default `true`)
  - the manifest `env` field is documentation plus UI hint only; do not assume omp fills it in.
- Plugin name key is the plugin's package name (`pi-ponytail`, per ticket 08), `cwd` from `ctx.cwd` (`types.ts:694`).
- Fallback if the deep import is rejected at spec time: no `pi.exec`/context route exists; the alternative is reading `omp-plugins.lock.json` directly (path from `getPluginsLockfile()`, itself in `pi-utils`, root-exported package `@oh-my-pi/pi-utils`), which is private format [INFERENCE: not recommended].

---

## Summary for other tickets

- 08 (packaging): both imports are by absolute path computed from `require.resolve("@dietrichgebert/ponytail")` main (`<root>/.opencode/plugins/ponytail.mjs` -> `../..`); the deep specifier `@dietrichgebert/ponytail/hooks/...` does **not** resolve. `"files"` ships `hooks/` including `hooks/band/*.ts` so no vendoring is needed. A manifest `env` for the token needs our own `process.env.PONYTAIL_WEBHOOK_TOKEN` fallback.
- 07/02/06: `webhookRequest` and the row type (`Snapshot`) live together in `metrics.ts`; the webhook payload is exactly the ledger-row `Snapshot`, so the Task/row decision in 06 fixes the webhook body too.
- 01 (compose): upstream's omp path has no map; our map handler must run after upstream's `before_agent_start` handler and append to the array it receives; handlers chain in registration order (`runner.ts:2261-2293`).
