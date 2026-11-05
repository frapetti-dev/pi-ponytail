# Research: compose upstream's `pi-extension/index.js` under omp 18.13.2

Ticket: `../issues/01-compose-upstream-extension.md`

**Verdict: composition works.** One import route is correct (resolve the package root from the *exported* main, then `import()` a file URL). Everything else the ticket asked is answered below, with a Bun proof that ran through omp's own extension loader.

## Sources used

- Upstream: **npm package `@dietrichgebert/ponytail@5.3.3`** installed with `bun add` into `%TEMP%/r01-ponytail` (not a git clone). Its `package.json` shows `exports` = `{".": "./.opencode/plugins/ponytail.mjs", "./plugin": same}`, `main` = same, `pi.extensions` = `["./pi-extension/index.js"]`. [INFERENCE] the npm 5.3.3 tarball equals commit `96608e0…`; I did not diff them.
- omp 18.13.2 source: `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/…` (cited as `omp:<path under src>`).
- Bun used for the proof: `bun 1.4.4` (`bun --version`). [INFERENCE] omp's own embedded Bun may differ in minor version; the proof imports omp's real loader source, so the loader logic is exercised, not its runtime build.

## Q1. Which import route works in Bun

Proof script `proof/routes.ts` and `proof/more.ts` in the scratch project. Output (condensed):

| Route | Result under Bun 1.4.4 |
|---|---|
| A. deep specifier `import("@dietrichgebert/ponytail/pi-extension/index.js")` | **FAIL**: `ERR_MODULE_NOT_FOUND Cannot find package '@dietrichgebert/ponytail'` (exports map blocks it). `require.resolve` and `import.meta.resolve` of the same specifier also fail; same for `…/hooks/ponytail-config.js`. |
| B. `require.resolve("@dietrichgebert/ponytail/package.json")` → dirname → file URL | OK **in Bun only**. Bun lets `package.json` through despite the exports map; Node throws `ERR_PACKAGE_PATH_NOT_EXPORTED` (verified with `node` v26.2.0). Do not rely on it. |
| C. `require.resolve("@dietrichgebert/ponytail")` (exported main) → walk up to the dir whose `package.json` has `name === "@dietrichgebert/ponytail"` → `import(pathToFileURL(root + "/pi-extension/index.js"))` | **OK**. Namespace exports: `completePonytailArgs, default, filterSkillBodyForMode, parsePonytailCommand, readDefaultMode, readQuietStartup, resolveSessionMode, writeDefaultMode`. Works in Bun and Node semantics (main is exported). |
| D. `createRequire(main)("../../pi-extension/index.js")` | OK in Bun (require of an ESM file), but returns a CJS-interop object; prefer C. |

File URLs and relative requires bypass the exports map, so everything under the package is reachable once the root is known (also `hooks/band/metrics.ts`, `hooks/ponytail-map.js`).

**Recommended route (C), as run** (`node_modules/pi-ponytail/upstream.ts` in the scratch project):

```ts
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const NAME = "@dietrichgebert/ponytail";
const req = createRequire(import.meta.url);
export function upstreamRoot(): string {
  let dir = path.dirname(req.resolve(NAME));           // main is in `exports`
  for (;;) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, "utf8")).name === NAME) return dir;
    const up = path.dirname(dir); if (up === dir) throw new Error(`cannot locate ${NAME}`);
    dir = up;
  }
}
export const root = upstreamRoot();
export const upstreamUrl = (rel: string) => pathToFileURL(path.join(root, rel)).href;
export const upstream = await import(upstreamUrl("pi-extension/index.js"));
export const upstreamRequire = createRequire(path.join(root, "package.json")); // upstreamRequire("./hooks/ponytail-config.js")
```

Top-level `await` in the plugin file loads fine through omp's loader (see "Proof through omp's real loader").

## Q2. Does the extension's relative `createRequire` of `../hooks/*.js` still resolve

Yes. `pi-extension/index.js:3-15` does `createRequire(import.meta.url)` and `require("../hooks/ponytail-config.js")` / `require("../hooks/ponytail-instructions.js")` at module top level. Because we `import()` it by file URL from inside `node_modules/@dietrichgebert/ponytail/`, `import.meta.url` is the real file and the relative requires resolve. The import completing at all (route C output above) proves it. Those hook files only use `fs`, `path`, `os` (`hooks/ponytail-config.js:12-14`, `hooks/ponytail-instructions.js:4-6`), so there are no further dependencies. `pi-extension/package.json` is `{"type":"module"}`, shipped in the tarball (`files` includes `pi-extension/`, excludes only `pi-extension/test/`).

omp's loader does not break this: omp loads every extension through `loadLegacyPiModule` (`omp:extensibility/extensions/loader.ts:420`), whose graph hook rewrites sources found by a **static** import walk (`omp:extensibility/plugins/legacy-pi-compat.ts:2531-2636`, `2737-2761`). Our computed-URL dynamic `import()` is not in that static graph, so upstream loads natively with a real `import.meta.url`. [INFERENCE] on that mechanism; the observable result (works, no errors) is proven below.

## Q3. `before_agent_start` with omp's array `systemPrompt`

Works, by design. `pi-extension/index.js:245-248`: `if (Array.isArray(event?.systemPrompt)) return { systemPrompt: [...event.systemPrompt, instructions] }`. omp passes `systemPrompt: string[]` and accepts a string or array back (`omp:extensibility/extensions/runner.ts:2249-2293`). omp does not supply `event.systemPromptOptions`, so the `sections` branch (`index.js:240-244`) is skipped. Handlers are chained: each handler sees the previous one's result (`runner.ts:2265-2290`).

Observed (`proof/run.ts`, fake pi): in `["BASE-A","BASE-B"]` → out length 3, first two unchanged, third `=== getPonytailInstructions("full")`. Level `off` → handler returns `undefined` (no injection). Through the real omp `ConcreteExtensionAPI` (`proof/omp-real2.ts`): in `["BASE"]` → out length 2, block 2 is the lite ruleset after switching to lite.

The ruleset block begins `PONYTAIL MODE ACTIVE — level: <level>` (observed, `getPonytailInstructions("full")` first line).

## Q4. Reading and switching the Level

Facts:
- State is a closure variable `currentMode` inside the default export (`index.js:74`), **not exported**. Upstream does export `resolveSessionMode(entries, fallback)` (`index.js:32-45`) and `readDefaultMode` (= `getDefaultMode`, `index.js:18`).
- Persistence is `pi.appendEntry("ponytail-mode", {mode})` (`index.js:106`). omp maps that to `sessionManager.appendCustomEntry`, which creates `{type:"custom", customType, data}` and records it synchronously (`omp:session/session-manager.ts:3672-3675`; wiring `omp:modes/controllers/extension-ui-controller.ts:222-224`, `omp:modes/runtime-init.ts:119`).
- Upstream restores from `ctx.sessionManager.getBranch()` on `session_start`, `session_tree`, `session_switch`, `session_branch` (`index.js:197-218`). `getBranch` is on omp's `ReadonlySessionManager` (`omp:session/session-manager.ts:724-748`), which is the type of `ctx.sessionManager`.
- `appendEntry` alone does **not** change upstream's in-memory level. Observed: after `pi.appendEntry("ponytail-mode",{mode:"lite"})` the injected ruleset was still `full`; it flipped to `lite` only after upstream's `session_switch` handler ran. So pi-ponytail must not switch Level by writing the entry itself.

**Read the Level** (no private state needed), validated in `proof/run.ts`:

```ts
const level = upstream.resolveSessionMode(ctx.sessionManager.getBranch(), upstream.readDefaultMode());
```

Observed: `full` at start, `ultra` after the switch. Valid values are `off|lite|full|ultra`; the helper can also return `review` if a persisted entry says so (`hooks/ponytail-config.js:17-18`, `32-34`), so the Band should tolerate it. Refresh the Band on the same events upstream uses plus our own observation below.

**Observe every Level change** (also `input` deactivation phrases like "stop ponytail", `index.js:188-195`): wrap `pi` in a `Proxy` before passing it to upstream and intercept `appendEntry` for `customType === "ponytail-mode"`. Observed in proof: `[observed level write] ultra`.

**Switch the Level programmatically** (Band's Level button): there is no extension API to run a registered command, and `pi.sendUserMessage("/ponytail ultra")` does **not** run it: `AgentSession.sendUserMessage` calls `prompt(text, {expandPromptTemplates:false,…})` (`omp:session/agent-session.ts:10255-10260`) and command routing is gated on `expandPromptTemplates` (`agent-session.ts:8121-8126`), so the text would be sent to the model. (`SendUserMessageOptions` has only `deliverAs` and `attribution`, `omp:session/agent-session-types.ts:513-518`.) What works: capture the command handler when upstream registers it, and call it directly.

```ts
let ponytailHandler;
const wrapped = new Proxy(pi, {
  get(target, key) {
    if (key === "registerCommand")
      return (name, opts) => { if (name === "ponytail") ponytailHandler = opts.handler; return target.registerCommand(name, opts); };
    if (key === "appendEntry")
      return (type, data) => { if (type === "ponytail-mode") onLevelChange(data.mode); return target.appendEntry(type, data); };
    const v = Reflect.get(target, key, target);
    return typeof v === "function" ? v.bind(target) : v;
  },
});
upstream.default(wrapped);
// Band button:  await ponytailHandler("ultra", ctx);
```

`ponytailHandler("ultra", ctx)` runs upstream's own `setMode`, which updates the closure, appends the entry, refreshes the status badge and notifies `"Ponytail mode set to ultra."` (`index.js:101-109`, `130-157`). Use explicit level words: bare `/ponytail` while on only reports status (`index.js:51-55`), and `default <level>` writes the config default instead (`index.js:138-152`). Upstream's user-facing toast says "mode" (`index.js:108`); we cannot change that wording.

Proxy forwarding detail: omp's `ConcreteExtensionAPI` rebinds methods as own props (`omp:extensibility/extensions/loader.ts:198-207`); the `bind(target)` fallback above is safe for them. Upstream uses only `on`, `registerCommand`, `appendEntry`, `sendUserMessage` of `pi`.

The command handler needs a `ctx` with `ui.notify`/`ui.setStatus`/`ui.theme`; keep the last `ctx` from our own events (upstream does the same, `lastCtx`, `index.js:78-83`).

## Q5. If upstream's own pi extension is also installed

When could it happen: omp scans plugins from the plugin root's `package.json#dependencies` plus the runtime lockfile (`omp:extensibility/plugins/loader.ts:105-149, 164-176`) and reads `pluginPkg.omp || pluginPkg.pi` as the manifest (`loader.ts:194`). Upstream's `package.json` has a `pi` key with `extensions: ["./pi-extension/index.js"]`. Our dependency on upstream is a *transitive* install, not a top-level plugin entry, so omp does **not** load upstream's extension by itself when only pi-ponytail is installed [INFERENCE from those two code paths: the nested package is not in the root `dependencies` list of the plugins dir, so it is not enumerated]. It would load as a second extension only if the user also installs upstream as a plugin (`omp plugin install @dietrichgebert/ponytail`) or via another native `.pi`/`.omp` extension source (`omp:extensibility/extensions/loader.ts:616-653`). Duplicates are removed only by the real path of the *entry file* (`loader.ts:598-605`), and `pi-ponytail/index.ts` ≠ `…/pi-extension/index.js`, so both load.

Observed with omp's real `loadExtensions([index.ts, raw-upstream.ts])` (`proof/omp-real.ts`; both entries call the same upstream factory):
- Each extension has its own command map; there are **no tools** registered by upstream (`ext.tools` empty), so no tool collision. `registerCommand` is a plain `Map.set` per extension (`omp:extensibility/extensions/loader.ts:234-243`).
- **Commands:** the combined view has one entry per name. `getRegisteredCommands` does `commands.set(name, …)` across extensions in order, so the last-loaded extension wins (`omp:extensibility/extensions/runner.ts:1407-1426`); `getCommand` scans from the last extension backward (`runner.ts:1432-1440`). Observed effective command names: 7 (6 upstream + our probe), no error or warning.
- **Events:** every extension's handlers all run. Both copies' `before_agent_start` handlers chained, giving `["BASE", ruleset, ruleset]` (3 blocks: **the ruleset is injected twice**). Both `session_*` handlers also run; the two copies keep independent in-memory levels. Since both read and write the same `ponytail-mode` entries, a `/ponytail ultra` handled by the last-loaded copy updates only that copy's closure and entry; the other copy re-syncs on the next `session_*` event only. So levels can diverge within a session. Status badge: both call `ui.setStatus("ponytail", …)` (same key), so the last writer wins.
- A possible mitigation (not run): in our `Proxy`, wrap `on("before_agent_start")` to skip when `event.systemPrompt` already has a block starting with `PONYTAIL MODE ACTIVE`. It only protects when ours runs after the other copy; the order of two plugin entries is not controllable by us. Recommendation for the spec: document "do not install upstream's omp plugin alongside pi-ponytail" and optionally add the guard.
- Each subagent rebinds the prepared factories to its own ExtensionAPI (`omp:extensibility/extensions/loader.ts:565-573` doc comment on `discoverExtensionPaths`). So our default export may be invoked again per subagent with a fresh `pi`; keep all state inside the factory (upstream does), and make module-level state in pi-ponytail read-only. Ticket 03 owns the subagent question.

## Proof through omp's real loader

Scratch project `%TEMP%/r01-ponytail` (`bun add @dietrichgebert/ponytail`; fake plugin `node_modules/pi-ponytail/` with `package.json` `omp.extensions`, `upstream.ts`, `index.ts`, `raw-upstream.ts`). `proof/omp-real*.ts` import omp's own `loadExtensions` / `ExtensionRuntime` from `…/pi-coding-agent/src/extensibility/extensions/loader.ts` and load the entries by absolute path, as `omp:extensibility/extensions/loader.ts:486-494` does.

Commands run (cwd `%TEMP%/r01-ponytail`) and output:

```
bun proof/routes.ts        -> A FAIL (ERR_MODULE_NOT_FOUND) / B OK / C OK / D OK (see table)
bun proof/run.ts           -> exports completePonytailArgs,default,filterSkillBodyForMode,parsePonytailCommand,readDefaultMode,readQuietStartup,resolveSessionMode,writeDefaultMode
                              commands: ponytail,ponytail-review,ponytail-audit,ponytail-gain,ponytail-debt,ponytail-help
                              events: input,session_start,session_tree,session_switch,session_branch,agent_start,agent_end,before_agent_start
                              array in/out: true 3 BASE-A|BASE-B | tail==full instructions: true
                              level before switch: full
                                 [observed level write] ultra
                              level after /ponytail ultra handler: ultra  entries: [{"type":"custom","customType":"ponytail-mode","data":{"mode":"ultra"}}]
                              appendEntry-only: injected level is still full? true (branch says lite)
                              after session_switch restore: injected lite? true
                              off -> undefined
bun proof/omp-real.ts      -> errors: []
                              EXT index.ts commands: ponytail,…,ponytail-help,ponytail-probe | tools: (none) | before_agent_start handlers: 1
                              EXT raw-upstream.ts commands: ponytail,…,ponytail-help | tools: (none) | before_agent_start handlers: 1
                              effective command count: 7
                              system prompt blocks after both extensions: 3     (BASE + 2 rulesets)
bun proof/omp-real2.ts     -> errors: []
                              entries: [{"type":"custom","customType":"ponytail-mode","data":{"mode":"lite"}}]
                              notes: Ponytail loaded: full | Ponytail mode set to lite. | level now lite
                              blocks: 2 lite marker present: true
```

So: import through omp's loader (including top-level `await` in our module and static graph walk) has no errors; the captured-handler switch writes the entry through the real `ConcreteExtensionAPI`; the ruleset changes level.

## Side findings for other tickets

1. **Upstream's skill-alias commands are likely broken on omp** (affects ticket 07 Review/Audit buttons and the "upstream owns the 5 skill commands" premise). `sendAlias` calls `pi.sendUserMessage("/skill:ponytail-review", {expandPromptTemplates:true})` (`pi-extension/index.js:111-125`). omp's `sendUserMessage` ignores that option and prompts with `expandPromptTemplates:false` (`omp:session/agent-session.ts:10255-10260`; `omp:session/agent-session-types.ts:513-518`). `/skill:` commands are expanded only in the TUI submit path, `isKnownSkillCommand`/`invokeSkillCommandFromText` (`omp:main.ts:479-487`, `omp:modes/skill-command.ts:55-91`). So the literal text `/skill:ponytail-review` reaches the model instead of the skill body. [INFERENCE] about the exact model behaviour; the code path is read, not run end to end (needs a model). I found no extension API to invoke a skill command (`omp:extensibility/extensions/types.ts`, grep "skill"). Ticket 07/08 should decide how Review/Audit send the skill (e.g. our own command that reads the skill body and sends it).
2. `hooks/band/metrics.ts` loads under Bun via file URL (route C) without errors. Its export list (observed): `CSV_HEADER, GREP_DEFS, MODEL_PATTERN, NO_TOKENS, TITLE_RECORD, addTokens, addedLines, callsIn, csvRow, defsIn, duration, elapsed, fmtTokens, hits, inProject, isCode, isSource, isTestCommand, mainModel, markdown, metricsSvg, parseDefs, percent, resume, sessionTitle, snapshot, stamp, taskKey, testCounts, testsLabel, totalTokens, upsertCsv, webhookRequest`. `webhookRequest` is in this pure module (relevant to ticket 05; ticket 02 owns the full purity audit). `hooks/ponytail-map.js` exports `buildMap` and loads through `upstreamRequire("./hooks/ponytail-map.js")` (ticket 05).
3. Packaging (ticket 08): `@dietrichgebert/ponytail` must be resolvable from the plugin file. Under `omp plugin install`, [INFERENCE] Bun installs it in the plugins dir `node_modules` (hoisted or nested); `require.resolve` from our file finds both. Under `omp plugin link` (symlink; loader mentions symlinked plugins at `omp:extensibility/plugins/loader.ts:165-170`, and `legacy-pi-compat.ts:2738-2741` realpath-resolves), dependencies must exist next to the real repo, i.e. run `bun install` in the repo.
4. Upstream `/ponytail` has no way to add subcommands (we only call its handler); `ponytailHandler` is only valid after upstream's factory ran, so register our commands after calling `upstream.default(wrapped)` and fail clearly if it is undefined.
5. Upstream config: `getConfigPath()` (`hooks/ponytail-config.js:67-69`, dir at `54-65`) resolves `$XDG_CONFIG_HOME/ponytail`, else `%APPDATA%/ponytail` on Windows, else `~/.config/ponytail`; exported from `hooks/ponytail-config.js:158-175` (`getConfigPath`, `getConfigDir`) for the `bandHidden` key. Note the Windows default is `%APPDATA%\ponytail`, not `~/.config/ponytail`; the ledger path rule belongs to ticket 02/06.
