# Subagent injection

Type: research
Status: resolved
Blocked by: none

## Question

In omp 18.13.2, do `task` subagents load plugin extensions and fire `before_agent_start`? If they do, does upstream's composed extension already inject the Ruleset into them? If not, which hook or API can add text to a subagent's system prompt, and what does it expose about the agent type, so upstream's `PONYTAIL_SUBAGENT_MATCHER` (case-insensitive regex on agent type) can be honoured? Cite omp source paths.

## Answer

- Yes: `task` subagents rebind the parent's extension factories (`preloadedPreparedExtensions`, `sdk.ts:2811-2825`), emit `session_start`, and fire `before_agent_start` on the assignment prompt. The event has no agent type; `ctx.agent` (`kind`, `id`, lowercased `name`, `depth`, `parentId`) does.
- Upstream's composed extension already injects into subagents, but at the config default Level (the child's fresh session has no `ponytail-mode` entry). It ignores the parent's `/ponytail off|ultra`, cannot honour `PONYTAIL_SUBAGENT_MATCHER`, and also hits `/tan` clones.
- Hook to use: `before_agent_start` inside the child, returning `{ systemPrompt: [...event.systemPrompt, instructions] }`. `before_subagent_spawn` cannot inject (only `model`/`note`/`block`).
- Recommended design: wrap `pi.on` so upstream's handler is skipped when `ctx.agent.kind === "sub"`. pi-ponytail's own handler tests the matcher (case-insensitive, vm timeout, fail-open) against `ctx.agent.name`, and takes the Level from a module-level `Map<agentId, level>` filled by the parent (looked up via `ctx.agent.parentId`).
- Known gap: revived or kept-alive subagent wake turns skip the hook (`executor.ts:4111-4119`).

Findings: [../research/subagent-injection.md](../research/subagent-injection.md)
