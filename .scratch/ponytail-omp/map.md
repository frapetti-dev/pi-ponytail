# Map: port ponytail to omp (ANSI + native Tern)

Label: wayfinder:map

## Destination

A locked spec at `.scratch/ponytail-omp/spec.md` for pi-ponytail. It is an omp plugin installable with `omp plugin install github:frapetti-dev/pi-ponytail`. It composes upstream ponytail's pi extension and adds the Band (native Tern + ANSI), the Ledger, the webhook, injecting the Ruleset into subagents, and the codebase map. Nothing is left to decide before building.

## Notes

- Domain: omp extension API (`@oh-my-pi/pi-coding-agent` 18.13.2 at `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/`) and upstream `DietrichGebert/ponytail` 5.3.3.
- Skills every session consults: `tern-ui` for any Band/UI ticket, plus `grilling` + `domain-modeling` for grilling tickets. Use the vocabulary in `GLOSSARY.md` (Level, not mode).
- Standing decisions:
  - depend on the npm package `@dietrichgebert/ponytail`, no vendoring
  - compose upstream's pi extension (`docs/adr/0001-compose-upstream-pi-extension.md`)
  - Ledger shared with Claude Code at `~/.config/ponytail/band/` with upstream's `CSV_HEADER`
  - webhook configured through `omp.settings`
  - Band toggle via `/ponytail-band [on|off]`, persisted as `bandHidden` in ponytail `config.json`
  - all 5 Band buttons (Level, Review, Audit, Copy, Fold)
  - ANSI keyboard access through commands only, no global shortcuts
- Research findings live in `.scratch/ponytail-omp/research/<slug>.md` and are linked from the ticket's Answer. The repo has no commits, so there are no research branches.
- Never touch any `.omp` directory while researching.

## Decisions so far

- [Compose upstream extension](issues/01-compose-upstream-extension.md): composable under omp 18.13.2 via `require.resolve` of the package main, walk up to the package root, `import()` of `pi-extension/index.js`; Level read with `resolveSessionMode(getBranch(), readDefaultMode())`, switched through a `Proxy` of `pi` that captures the `/ponytail` handler.
- [Band metric sources](issues/02-band-metric-sources.md): every Band field has an omp source (cost/tokens from `getUsageStatistics()` minus a Task baseline, a turn is `agent_end` with `willContinue !== true`, edit text from `details.oldText/newText`); `metrics.ts` is pure and loads by dynamic `import()`.
- [Subagent injection](issues/03-subagent-injection.md): subagents fire `before_agent_start` but upstream injects the config-default Level into them; use `ctx.agent.kind/name/parentId`, skip upstream's handler for `sub`, and gate Band/Ledger/map on `kind === "main"`.
- [Band widget host](issues/04-band-widget-host.md): `omp.btn` clicks reach `handleNativeEvent` (button name `copy` is reserved by Tern, use `copy-md`); `handleInput` never fires; clipboard via `copyToClipboard` from the package root shim.
- [Map and webhook reuse](issues/05-map-and-webhook-reuse.md): `buildMap` and `webhookRequest` are importable from the package; map is not added by upstream's omp extension, so we add it per prompt from a session-cached string; settings via `getPluginSettings` with our own env/default fallback.

## Not yet specified

- How the spec is assembled: section layout of `spec.md` and which decisions become acceptance criteria.
- Test strategy: which upstream test harness patterns (`pi-extension/test` `createPiHarness`) carry over, and how to exercise the native TSP Band (describe-harness from the tern-ui skill).
- Cost semantics in the shared Ledger: omp reports provider-priced `usage.cost` for non-Anthropic models. Whether that needs any marking beyond the `model` column.
- Upstream version pinning and how upgrades are verified.

## Out of scope

- The Board (HTML dashboard) and its Band button: ruled out by the user.
- `/ponytail band import` of past sessions: ruled out by the user.
- Fixing the separate `frapetti-dev/tern-ui` plugin install failure: not part of this effort.
