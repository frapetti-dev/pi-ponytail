import vm from "node:vm";
import type { Ctx, Level, Pi } from "./types";
import { config, currentLevel, instructions } from "./upstream";

/**
 * Agent id -> Level. Module state, shared by the parent and every subagent session because the module is
 * imported once while the extension factory re-runs per session.
 */
const levels = new Map<string, Level>();
let lastMainId: string | undefined;

/** Remember the main session's Level so subagents spawned from it inherit it. */
export function recordLevel(ctx: Ctx, level: Level = currentLevel(ctx)): void {
	if (!ctx.agent) return;
	lastMainId = ctx.agent.id;
	levels.set(ctx.agent.id, level);
}

/** Level change observed from the proxy, where only the last main session is known. */
export function setLastMainLevel(level: Level): void {
	if (lastMainId) levels.set(lastMainId, level);
}

export function forgetLevel(ctx: Ctx): void {
	if (ctx.agent) levels.delete(ctx.agent.id);
}

/** Skip only on a definite non-match; an invalid regex, a throw/timeout or an empty name fails open. */
function matcherSkips(name: string): boolean {
	const src = process.env.PONYTAIL_SUBAGENT_MATCHER;
	if (!src || !name) return false;
	try {
		const re = new RegExp(src, "i");
		return vm.runInNewContext("re.test(s)", { re, s: name }, { timeout: 100 }) === false;
	} catch {
		return false;
	}
}

export function registerSubagentInjection(pi: Pi): void {
	pi.on<{ systemPrompt: string[] }>("before_agent_start", (event, ctx) => {
		const agent = ctx.agent;
		if (agent?.kind !== "sub") return undefined;
		if (matcherSkips(agent.name)) return undefined;
		const level = levels.get(agent.parentId ?? "") ?? (config.getDefaultMode() as Level);
		levels.set(agent.id, level);
		if (level === "off") return undefined;
		return { systemPrompt: [...event.systemPrompt, instructions.getPonytailInstructions(level)] };
	});
}
