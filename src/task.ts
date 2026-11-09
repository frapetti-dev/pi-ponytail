import path from "node:path";
import type { Ctx, SessionEntryLike } from "./types";
import { type BandData, currentLevel, metrics, type Snapshot } from "./upstream";

/** Everything the tracker needs from the outside world, so tests inject fakes. */
export interface Host {
	exec(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; code: number }>;
	/** File text, or undefined when the file does not exist. */
	readFile(file: string): Promise<string | undefined>;
	now(): number;
	readLedger(project: string): Promise<string>;
	writeLedger(row: Snapshot): Promise<void>;
	sendWebhook(row: Snapshot, ctx: Ctx): Promise<void>;
}

export interface InputEvent {
	text: string;
	source?: string;
}
export interface MessageEndEvent {
	message: { role: string; provider?: string; model?: string };
}
export interface ToolCallEvent {
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
}
export interface ToolResultEvent {
	toolName: string;
	toolCallId: string;
	input: Record<string, unknown>;
	content?: { type: string; text?: string }[];
	details?: EditDetails;
	isError: boolean;
}
export interface AgentEndEvent {
	willContinue?: boolean;
}
interface FileEdit {
	path?: string;
	oldText?: string;
	newText?: string;
	isError?: boolean;
}
interface EditDetails extends FileEdit {
	perFileResults?: FileEdit[];
}

interface Baseline {
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

interface TaskState {
	sessionId: string;
	startedAt: number;
	gitRoot: string | undefined;
	band: BandData;
	baseline: Baseline;
	models: Map<string, number>;
	known: Map<string, string>;
	lastBoundaryId: string | undefined;
	turnOpen: boolean;
	turnStartCost: number;
	agentStartedAt: number | undefined;
	pendingWrites: Map<string, { file: string; before: string }>;
	firstPrompt: string | undefined;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const isFsPath = (p: string) => !/^[a-z]{2,}:/i.test(p);
const textOf = (content: ToolResultEvent["content"]) =>
	(content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");

const lastBoundary = (ctx: Ctx): SessionEntryLike | undefined => {
	const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? [];
	return entries.findLast((e) => e.type === "reset_boundary");
};

/** One Task per session segment (a /clear starts a new one); main sessions only, callers gate on that. */
export class TaskTracker {
	#state: TaskState | undefined;
	#ledgerFailed = false;

	constructor(
		private readonly host: Host,
		private readonly onChange: () => void,
	) {}

	/** Current Band data and the Task's start, for the widget and the Markdown copy. */
	get current(): { band: BandData; startedAt: number } | undefined {
		return this.#state ? { band: this.#state.band, startedAt: this.#state.startedAt } : undefined;
	}

	snapshot(): Snapshot | undefined {
		const c = this.current;
		return c ? metrics.snapshot(c.band, c.startedAt) : undefined;
	}

	setLevel(level: string): void {
		if (this.#state) this.#state.band = { ...this.#state.band, level };
	}

	async startTask(ctx: Ctx, boundary?: SessionEntryLike): Promise<void> {
		const sm = ctx.sessionManager;
		const sessionId = sm.getSessionId();
		const stamp = boundary?.timestamp ?? sm.getHeader()?.timestamp;
		const startedAt = stamp ? Date.parse(stamp) : this.host.now();
		const top = await this.host.exec("git", ["rev-parse", "--show-toplevel"], ctx.cwd);
		const gitRoot = top.code === 0 && top.stdout.trim() !== "" ? top.stdout.trim() : undefined;
		const project = path.basename(gitRoot ?? ctx.cwd);
		const stats = sm.getUsageStatistics();
		const baseline: Baseline = {
			cost: stats.cost,
			input: stats.input,
			output: stats.output,
			cacheRead: stats.cacheRead,
			cacheWrite: stats.cacheWrite,
		};
		const defs = await this.host.exec("git", ["grep", "--untracked", "-nE", metrics.GREP_DEFS], ctx.cwd);
		const known = defs.code === 0 ? metrics.parseDefs(defs.stdout) : new Map<string, string>();
		let band: BandData = {
			level: currentLevel(ctx),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
			cost: stats.cost,
			spent: 0,
			turns: 0,
			turnCosts: [],
			tokens: metrics.NO_TOKENS,
			busyMs: 0,
			name: "",
			project,
			session: sessionId,
			reused: [],
			created: [],
			removed: [],
			openCallers: [],
			tests: { state: "none" },
		};
		const csv = await this.host.readLedger(project).catch(() => "");
		band = metrics.resume(band, csv, metrics.taskKey(sessionId, startedAt));
		this.#state = {
			sessionId,
			startedAt,
			gitRoot,
			band,
			baseline,
			models: new Map(),
			known,
			lastBoundaryId: lastBoundary(ctx)?.id,
			turnOpen: false,
			turnStartCost: stats.cost,
			agentStartedAt: undefined,
			pendingWrites: new Map(),
			firstPrompt: undefined,
		};
		this.onChange();
	}

	/** /clear leaves a reset_boundary entry on the branch; the first prompt after it starts a new Task. */
	async beforeAgentStart(ctx: Ctx): Promise<void> {
		const entry = lastBoundary(ctx);
		if (entry && entry.id !== this.#state?.lastBoundaryId) await this.startTask(ctx, entry);
	}

	input(event: InputEvent): void {
		const s = this.#state;
		if (!s || s.firstPrompt || event.source === "extension" || event.text.startsWith("/")) return;
		s.firstPrompt = event.text.split("\n")[0]?.slice(0, 60);
	}

	agentStart(ctx: Ctx): void {
		const s = this.#state;
		if (!s) return;
		s.agentStartedAt = this.host.now();
		if (!s.turnOpen) {
			s.turnOpen = true;
			s.turnStartCost = ctx.sessionManager.getUsageStatistics().cost;
		}
	}

	messageEnd(event: MessageEndEvent): void {
		const s = this.#state;
		const m = event.message;
		if (!s || m.role !== "assistant") return;
		const key = `${m.provider}/${m.model}`;
		s.models.set(key, (s.models.get(key) ?? 0) + 1);
	}

	async toolCall(event: ToolCallEvent, ctx: Ctx): Promise<void> {
		const s = this.#state;
		const p = event.input.path;
		if (!s || event.toolName !== "write" || typeof p !== "string" || !isFsPath(p)) return;
		const file = path.resolve(ctx.cwd, p);
		s.pendingWrites.set(event.toolCallId, { file, before: (await this.host.readFile(file)) ?? "" });
	}

	toolResult(event: ToolResultEvent, ctx: Ctx): void {
		const s = this.#state;
		if (!s) return;
		const pending = s.pendingWrites.get(event.toolCallId);
		s.pendingWrites.delete(event.toolCallId);
		// A failed test run is data (state "fail"); a failed edit or write changed nothing.
		if (event.isError && event.toolName !== "bash") return;
		if (event.toolName === "write" && pending) {
			const content = event.input.content;
			if (typeof content === "string") this.#apply(s, ctx, pending.file, pending.before, content);
		} else if (event.toolName === "edit") {
			const d = event.details;
			const files = d?.perFileResults ?? (d ? [d] : []);
			for (const f of files) {
				// Pruned snapshots carry neither text; skip silently rather than parse the diff.
				if (f.isError || !f.path || (f.oldText === undefined && f.newText === undefined)) continue;
				this.#apply(s, ctx, path.resolve(ctx.cwd, f.path), f.oldText ?? "", f.newText ?? "");
			}
		} else if (event.toolName === "bash") {
			const command = event.input.command;
			if (event.input.async === true || typeof command !== "string" || !metrics.isTestCommand(command)) return;
			s.band = {
				...s.band,
				tests: { state: event.isError ? "fail" : "pass", ...metrics.testCounts(textOf(event.content)) },
			};
		}
	}

	#apply(s: TaskState, ctx: Ctx, file: string, before: string, after: string): void {
		const root = s.gitRoot ?? ctx.cwd;
		if (!metrics.inProject(file, root)) return;
		const rel = path.relative(root, file).replace(/\\/g, "/");
		const source = metrics.isSource(rel);
		const oldDefs = metrics.defsIn(file, before);
		const newDefs = metrics.defsIn(file, after);
		const created = source ? newDefs.filter((n) => !oldDefs.includes(n)) : [];
		const removed = oldDefs.filter((n) => !newDefs.includes(n));
		const reused = source ? metrics.callsIn(metrics.addedLines(before, after), s.known, newDefs) : [];
		const b = s.band;
		s.band = {
			...b,
			reused: union(b.reused, reused),
			created: union(b.created, created),
			removed: union(b.removed, removed),
			tests: metrics.isCode(file) && b.tests.state !== "none" ? { ...b.tests, state: "stale" } : b.tests,
		};
	}

	async agentEnd(event: AgentEndEvent, ctx: Ctx): Promise<void> {
		const s = this.#state;
		if (!s) return;
		if (s.agentStartedAt !== undefined) s.band = { ...s.band, busyMs: s.band.busyMs + this.host.now() - s.agentStartedAt };
		s.agentStartedAt = undefined;
		if (event.willContinue === true) return;

		const stats = ctx.sessionManager.getUsageStatistics();
		const base = s.baseline;
		const stillRemoved: string[] = [];
		const open: string[] = [];
		for (const name of s.band.removed) {
			const grep = await this.host.exec("git", ["grep", "--untracked", "-nw", "-e", name], ctx.cwd);
			const rows = grep.code === 0 ? metrics.hits(grep.stdout) : [];
			if (rows.some((r) => metrics.defsIn(r.file, r.text.trimStart()).includes(name))) continue;
			const call = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}\\s*\\(`);
			const refs = rows.filter((r) => call.test(r.text)).map((r) => `${r.file}:${r.line}`);
			if (refs.length > 0) {
				stillRemoved.push(name);
				open.push(...refs);
			}
		}

		const topModel = [...s.models].sort((a, b) => b[1] - a[1])[0]?.[0];
		s.band = {
			...s.band,
			level: currentLevel(ctx),
			turns: s.band.turns + 1,
			spent: stats.cost - base.cost,
			cost: stats.cost,
			turnCosts: [...s.band.turnCosts, stats.cost - s.turnStartCost].slice(-20),
			tokens: {
				input: stats.input - base.input,
				output: stats.output - base.output,
				cacheRead: stats.cacheRead - base.cacheRead,
				cacheWrite: stats.cacheWrite - base.cacheWrite,
			},
			name: ctx.sessionManager.getSessionName() || s.firstPrompt || s.band.name,
			model: topModel ?? s.band.model,
			removed: stillRemoved,
			openCallers: open,
		};
		s.turnOpen = false;

		const row = metrics.snapshot(s.band, s.startedAt);
		try {
			await this.host.writeLedger(row);
		} catch (e) {
			if (!this.#ledgerFailed) {
				this.#ledgerFailed = true;
				ctx.ui.notify(`ponytail band: ledger write failed: ${e instanceof Error ? e.message : String(e)}`, "error");
			}
		}
		await this.host.sendWebhook(row, ctx);
		this.onChange();
	}
}
