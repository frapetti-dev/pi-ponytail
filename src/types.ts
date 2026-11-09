/** Minimal structural view of the omp extension host; only members this plugin touches. */

export type Level = "off" | "lite" | "full" | "ultra" | "review";

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface SessionEntryLike {
	id?: string;
	type: string;
	timestamp?: string;
	[key: string]: unknown;
}

export interface Theme {
	fg(color: string, text: string): string;
}

export interface Tui {
	requestRender(): void;
}

export interface WidgetComponent {
	render(width: number): string[];
	invalidate(): void;
	dispose?(): void;
	describe?(cx: { dark: boolean; cols: number }): unknown;
	handleNativeEvent?(ev: { type: string; key?: string; [k: string]: unknown }): void;
}

export interface OverlayComponent extends WidgetComponent {
	nativeOverlay?: { role?: string; head?: string };
	handleInput?(data: string): void;
}

export type WidgetFactory = (tui: Tui, theme: Theme) => WidgetComponent;

export interface AgentIdentity {
	kind: "main" | "sub";
	id: string;
	name: string;
	depth: number;
	parentId?: string;
}

export interface Ctx {
	cwd: string;
	hasUI: boolean;
	agent?: AgentIdentity;
	model?: { provider: string; id: string };
	ui: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		setStatus(key: string, text: string | undefined): void;
		setWidget(key: string, content: WidgetFactory | string[] | undefined, options?: { placement?: string }): void;
		custom<T>(
			factory: (tui: Tui, theme: Theme, keybindings: unknown, done: (result: T) => void) => OverlayComponent,
			options?: { overlay?: boolean; overlayOptions?: { width?: string } },
		): Promise<T>;
		theme?: Theme;
	};
	isIdle(): boolean;
	sessionManager: {
		getBranch(): SessionEntryLike[];
		getEntries?(): SessionEntryLike[];
		getSessionId(): string;
		getHeader(): { timestamp: string } | null;
		getSessionName(): string | undefined;
		getUsageStatistics(): UsageStats;
	};
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export interface CommandOptions {
	description?: string;
	getArgumentCompletions?(prefix: string): { value: string; label: string }[] | null;
	handler(args: string, ctx: Ctx): Promise<void> | void;
}

/** Event payload shape differs per event; handlers annotate their own event type. */
export type Handler<E = never> = (event: E, ctx: Ctx) => unknown;

export interface Pi {
	on<E>(event: string, handler: Handler<E>): void;
	registerCommand(name: string, options: CommandOptions): void;
	appendEntry(customType: string, data?: unknown): void;
	sendUserMessage(content: string, options?: { deliverAs?: "followUp" | "steer" }): void;
	exec(command: string, args: string[], options?: { cwd?: string }): Promise<ExecResult>;
}

export const isMain = (ctx: Ctx): boolean => (ctx.agent ? ctx.agent.kind === "main" : true);
