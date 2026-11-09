import type { Ctx, Pi } from "./types";
import { currentLevel, mapModule } from "./upstream";

interface MapState {
	cwd: string;
	text: Promise<string>;
}

/** Build the map once per cwd, deferred so omp paints first; buildMap is synchronous and takes 0.3-2.5 s. */
function startMap(state: { current?: MapState }, ctx: Ctx): MapState {
	if (state.current?.cwd === ctx.cwd) return state.current;
	const { promise: text, resolve } = Promise.withResolvers<string>();
	setTimeout(() => {
		try {
			resolve(mapModule.buildMap(ctx.cwd) || "");
		} catch {
			resolve("");
		}
	}, 0);
	state.current = { cwd: ctx.cwd, text };
	return state.current;
}

export function registerMap(pi: Pi): void {
	const state: { current?: MapState } = {};

	for (const event of ["session_start", "session_switch", "session_branch"]) {
		pi.on(event, (_e: unknown, ctx) => {
			if (ctx.agent?.kind !== "sub" && process.env.PONYTAIL_MAP !== "0") startMap(state, ctx);
		});
	}

	// omp's systemPrompt override is per turn, so this returns the same cached string on every prompt.
	pi.on<{ systemPrompt: string[] }>("before_agent_start", async (event, ctx) => {
		if (ctx.agent?.kind === "sub" || process.env.PONYTAIL_MAP === "0") return undefined;
		const level = currentLevel(ctx);
		if (level === "off" || level === "review") return undefined;
		const text = await startMap(state, ctx).text;
		if (!text || event.systemPrompt.some((b) => b.startsWith("Codebase map ("))) return undefined;
		return { systemPrompt: [...event.systemPrompt, text] };
	});
}
