import { upstream } from "./upstream";
import type { CommandOptions, Ctx, Handler, Level, Pi } from "./types";

type PromptEvent = { systemPrompt: unknown };
type CommandHandler = (args: string, ctx: Ctx) => Promise<void> | void;

const hasRulesetBlock = (prompt: unknown): boolean =>
	Array.isArray(prompt) && prompt.some((b) => typeof b === "string" && b.startsWith("PONYTAIL MODE ACTIVE"));

/**
 * Runs upstream's pi extension against a Proxy of `pi` that (a) captures its `/ponytail` handler so the Band
 * and Panel can switch Levels, (b) reports every persisted Level change, (c) skips upstream's Ruleset injection
 * for subagents (src/subagent.ts owns those) and when another copy already injected it, and (d) opens the Panel
 * for bare `/ponytail`.
 */
export function composeUpstream(
	pi: Pi,
	hooks: { onLevelChange(level: Level): void; openPanel(ctx: Ctx): Promise<void> },
): { setLevel(level: Level, ctx: Ctx): Promise<void>; setDefault(level: Level, ctx: Ctx): Promise<void> } {
	let ponytailHandler: CommandHandler | undefined;
	let warned = false;

	const wrapped = new Proxy(pi, {
		get(target, key) {
			if (key === "registerCommand") {
				return (name: string, opts: CommandOptions) => {
					if (name !== "ponytail") return target.registerCommand(name, opts);
					ponytailHandler = opts.handler;
					// Bare `/ponytail` opens the Panel; arguments and headless sessions keep upstream's behaviour.
					return target.registerCommand(name, {
						...opts,
						handler: (args, ctx) => (args.trim() === "" && ctx.hasUI ? hooks.openPanel(ctx) : opts.handler(args, ctx)),
					});
				};
			}
			if (key === "appendEntry") {
				return (type: string, data?: unknown) => {
					if (type === "ponytail-mode" && data && typeof data === "object" && "mode" in data && typeof data.mode === "string") {
						hooks.onLevelChange(data.mode as Level);
					}
					return target.appendEntry(type, data);
				};
			}
			if (key === "on") {
				return (event: string, handler: Handler<PromptEvent>) => {
					if (event !== "before_agent_start") return target.on(event, handler);
					target.on<PromptEvent>(event, (ev, ctx) => {
						if (ctx.agent?.kind === "sub") return undefined;
						if (hasRulesetBlock(ev.systemPrompt)) {
							if (!warned) {
								warned = true;
								ctx.ui.notify(
									"pi-ponytail: upstream's ponytail extension is also installed; the Ruleset is injected once. Uninstall one of the two.",
									"warning",
								);
							}
							return undefined;
						}
						return handler(ev, ctx);
					});
				};
			}
			const v = Reflect.get(target, key, target);
			return typeof v === "function" ? v.bind(target) : v;
		},
	});

	upstream.default(wrapped);
	if (!ponytailHandler) throw new Error("pi-ponytail: upstream did not register /ponytail");
	const handler = ponytailHandler;

	return {
		async setLevel(level, ctx) {
			await handler(level, ctx);
		},
		async setDefault(level, ctx) {
			await handler(`default ${level}`, ctx);
		},
	};
}
