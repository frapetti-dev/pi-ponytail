# Map and webhook reuse

Type: research
Status: resolved
Blocked by: none

## Question

Codebase map:
- Is `buildMap(root)` in upstream `hooks/ponytail-map.js` exported and importable from the npm package?
- What are its runtime cost and failure modes (3 s timeout, `git ls-files` fallback)?
- How do `PONYTAIL_MAP=0` and `PONYTAIL_MAP_CHARS` behave?
- In which omp hook should the map be added, and how often (per session vs per `before_agent_start`)?

Webhook:
- Is upstream's `webhookRequest(url, token, sendNames, row)` exported from a pure module, or is it inside `hooks/band/register.tsx` (Claude SDK)?
- Give its exact refusal rules (https only except localhost/127.0.0.1/[::1]) and payload, so pi-ponytail can reuse or match it.
- How does an omp extension read `omp.settings` values, including secret and `env` (`getPluginSettings(name, cwd)` or an API on `pi`)?

## Answer

- **Map**: `buildMap` is exported (CJS, `hooks/ponytail-map.js:109`) and ships in the npm package; the deep specifier `@dietrichgebert/ponytail/hooks/...` does NOT resolve under Bun, but `createRequire(<resolved main>)` of the absolute path `<main>/../..` + `hooks/ponytail-map.js` works (verified, Bun 1.4.4). It is sync, ~0.3 s in a git repo, 2.5 s on a large non-git tree, throws on a bad root, and has no timeout of its own: the "3 s" is `git ls-files`'s timeout plus the activate hook's outer child-process timeout. `PONYTAIL_MAP=0` is NOT read by the module (only by `ponytail-activate.js`), `PONYTAIL_MAP_CHARS` is read once at import (`0` -> empty, non-numeric -> no budget). Upstream's omp extension injects no map, so pi-ponytail adds a `before_agent_start` handler after composing upstream, returning `[...event.systemPrompt, map]` on every prompt (omp's override is per turn) from a string computed once per session.
- **Webhook**: `webhookRequest` is in the pure `hooks/band/metrics.ts:299` (no Claude SDK), importable via file URL; https only except `localhost`/`127.0.0.1`/`[::1]` over http; Bearer only when token non-empty; body is the full ledger `Snapshot` (`name:''` when `sendNames` is false). Reuse it, do not re-implement.
- **Settings**: no `pi` API; only `getPluginSettings(name, cwd)` in `@oh-my-pi/pi-coding-agent/extensibility/plugins/loader`, and it returns stored values only: `env` and `default` are NOT applied (secrets are plain text in the 0600 lockfile), so pi-ponytail must fall back to `process.env.PONYTAIL_WEBHOOK_TOKEN` and `sendNames !== false` itself.
- Details: [../research/map-and-webhook-reuse.md](../research/map-and-webhook-reuse.md)
