import type { CommandOptions, Ctx, Handler, Level, OverlayComponent, Pi, SessionEntryLike, UsageStats } from "../src/types";

export interface FakePi extends Pi {
	handlers: Map<string, Handler<never>[]>;
	commands: Map<string, CommandOptions>;
	entries: { type: string; data: unknown }[];
	sent: { content: string; options?: { deliverAs?: string } }[];
	emit(event: string, payload: unknown, ctx: Ctx): Promise<unknown[]>;
}

export function fakePi(exec?: Pi["exec"]): FakePi {
	const pi: FakePi = {
		handlers: new Map(),
		commands: new Map(),
		entries: [],
		sent: [],
		on(event, handler) {
			const list = pi.handlers.get(event) ?? [];
			list.push(handler as Handler<never>);
			pi.handlers.set(event, list);
		},
		registerCommand(name, options) {
			pi.commands.set(name, options);
		},
		appendEntry(type, data) {
			pi.entries.push({ type, data });
		},
		sendUserMessage(content, options) {
			pi.sent.push({ content, options });
		},
		exec: exec ?? (async () => ({ stdout: "", stderr: "", code: 1 })),
		async emit(event, payload, ctx) {
			const out: unknown[] = [];
			for (const h of pi.handlers.get(event) ?? []) out.push(await (h as Handler<unknown>)(payload, ctx));
			return out;
		},
	};
	return pi;
}

export interface FakeCtx extends Ctx {
	notes: { message: string; type?: string }[];
	statuses: Map<string, string | undefined>;
	widgets: Map<string, unknown>;
	branch: SessionEntryLike[];
	stats: UsageStats;
	overlay?: OverlayComponent;
	overlayOptions?: unknown;
}

export function fakeCtx(opts: Partial<{ kind: "main" | "sub"; id: string; name: string; parentId: string; level: Level; cwd: string; hasUI: boolean }> = {}): FakeCtx {
	const ctx: FakeCtx = {
		cwd: opts.cwd ?? process.cwd(),
		hasUI: opts.hasUI ?? true,
		agent: { kind: opts.kind ?? "main", id: opts.id ?? "main-1", name: opts.name ?? "main", depth: 0, parentId: opts.parentId },
		model: { provider: "anthropic", id: "claude-x" },
		notes: [],
		statuses: new Map(),
		widgets: new Map(),
		branch: opts.level ? [{ type: "custom", customType: "ponytail-mode", data: { mode: opts.level } }] : [],
		stats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		ui: {
			notify: (message, type) => void ctx.notes.push({ message, type }),
			setStatus: (key, text) => void ctx.statuses.set(key, text),
			setWidget: (key, content) => void ctx.widgets.set(key, content),
			custom: (factory, options) => {
				const { promise, resolve } = Promise.withResolvers<never>();
				ctx.overlayOptions = options;
				ctx.overlay = factory({ requestRender: () => {} }, { fg: (_c, t) => t }, {}, (v) => {
					ctx.overlay = undefined;
					resolve(v as never);
				});
				return promise;
			},
		},
		isIdle: () => true,
		sessionManager: {
			getBranch: () => ctx.branch,
			getEntries: () => ctx.branch,
			getSessionId: () => "sess-0001-aaaa",
			getHeader: () => ({ timestamp: "2026-01-01T00:00:00.000Z" }),
			getSessionName: () => undefined,
			getUsageStatistics: () => ctx.stats,
		},
	};
	return ctx;
}
