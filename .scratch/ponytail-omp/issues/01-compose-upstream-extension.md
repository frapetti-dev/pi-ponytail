# Compose upstream extension

Type: research
Status: resolved
Blocked by: none

## Question

Can pi-ponytail import and call upstream's `pi-extension/index.js` default export from the npm package `@dietrichgebert/ponytail` under omp 18.13.2? The package's `exports` map lists only `.` and `./plugin`, so find out:
- which import route works in Bun (deep specifier, `createRequire` on the resolved main path, or a filesystem path relative to `require.resolve`)
- whether the extension's relative `createRequire` of `../hooks/*.js` still resolves
- whether its `before_agent_start` handling works with omp's array `systemPrompt`
- how our code can read the current Level (upstream persists `appendEntry("ponytail-mode", {mode})` and restores from `sessionManager.getBranch()`) and switch Level programmatically for the Band's Level button
- what happens to command and tool registration if upstream's own pi extension is also installed

Prove the route with a scratch `bun` project in the OS temp dir.

## Answer

Yes, composition works and was proven through omp's own `loadExtensions` (bun 1.4.4, npm 5.3.3).
- **Import route:** deep specifier fails (`ERR_MODULE_NOT_FOUND`). Use `require.resolve("@dietrichgebert/ponytail")` (exported main), walk up to the dir whose `package.json` name matches, then `await import(pathToFileURL(root + "/pi-extension/index.js").href)`. File URLs bypass `exports`; upstream's relative `createRequire("../hooks/*.js")` resolves (no other deps). (Bun also lets `…/package.json` resolve, Node doesn't, so don't use it.)
- **`before_agent_start`:** upstream already handles omp's `string[]` prompt (`[...systemPrompt, instructions]`); chained results from several extensions work. Observed `["BASE"]` → `["BASE", ruleset]`; `off` → no injection.
- **Level:** read with `upstream.resolveSessionMode(ctx.sessionManager.getBranch(), upstream.readDefaultMode())`. `appendEntry` alone does not change upstream's closure state, and `pi.sendUserMessage("/ponytail x")` does not run commands in omp. Switch by passing upstream a `Proxy` of `pi` that captures the `ponytail` command handler and observes `appendEntry("ponytail-mode")`, then call `handler("ultra", ctx)`.
- **If upstream's extension is also installed:** no tool collision (upstream registers none); commands are last-loaded-wins with no warning; all `before_agent_start` handlers run, so the ruleset is injected twice and levels can diverge. Not a problem when only pi-ponytail is installed (upstream is a transitive dep, not an omp plugin entry).
- **Surprise:** upstream's `/ponytail-review|audit|…` aliases send a literal `/skill:…` string, because omp's `sendUserMessage` ignores `expandPromptTemplates` (see research, side finding 1; matters for ticket 07 Review/Audit buttons).

Details, proof output and citations: [../research/compose-upstream-extension.md](../research/compose-upstream-extension.md)
