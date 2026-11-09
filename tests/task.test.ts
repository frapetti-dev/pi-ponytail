import { beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Host, TaskTracker } from "../src/task";
import { metrics } from "../src/upstream";
import { type FakeCtx, fakeCtx } from "./helpers";

const repo = path.join(os.tmpdir(), "ponytail-proj");

beforeAll(() => {
	process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-task-"));
	process.env.PONYTAIL_DEFAULT_MODE = "full";
});

interface Fixture {
	tracker: TaskTracker;
	ctx: FakeCtx;
	csv: { text: string };
	files: Map<string, string>;
	sent: unknown[];
	grepFor: Map<string, string>;
}

function setup(csv = ""): Fixture {
	const state = { text: csv };
	const files = new Map<string, string>();
	const sent: unknown[] = [];
	const grepFor = new Map<string, string>();
	const host: Host = {
		async exec(_cmd, args) {
			if (args[0] === "rev-parse") return { stdout: `${repo}\n`, code: 0 };
			if (args.includes("-nE")) return { stdout: "src/lib.ts:1:export function helper() {}\n", code: 0 };
			const name = args[args.length - 1] ?? "";
			const out = grepFor.get(name);
			return out === undefined ? { stdout: "", code: 1 } : { stdout: out, code: 0 };
		},
		readFile: async (f) => files.get(f),
		now: () => 1_000,
		readLedger: async () => state.text,
		writeLedger: async (row) => {
			state.text = metrics.upsertCsv(state.text, row);
		},
		sendWebhook: async (row) => void sent.push(row),
	};
	const ctx = fakeCtx({ cwd: repo });
	ctx.stats = { input: 100, output: 10, cacheRead: 50, cacheWrite: 5, cost: 5 };
	return { tracker: new TaskTracker(host, () => {}), ctx, csv: state, files, sent, grepFor };
}

const rows = (csv: string) => csv.split("\n").filter((l) => l && !l.startsWith("key,"));

test("only terminal agent_end counts a turn; one ledger row; spent and tokens are deltas from the baseline", async () => {
	const f = setup();
	await f.tracker.startTask(f.ctx);
	f.tracker.agentStart(f.ctx);
	f.ctx.stats = { input: 160, output: 40, cacheRead: 60, cacheWrite: 5, cost: 5.1 };
	await f.tracker.agentEnd({ willContinue: true }, f.ctx);
	expect(f.tracker.current?.band.turns).toBe(0);
	expect(rows(f.csv.text)).toHaveLength(0);

	f.tracker.agentStart(f.ctx);
	f.ctx.stats = { input: 200, output: 50, cacheRead: 70, cacheWrite: 5, cost: 5.25 };
	await f.tracker.agentEnd({}, f.ctx);
	const band = f.tracker.current?.band;
	expect(band?.turns).toBe(1);
	expect(band?.spent).toBeCloseTo(0.25);
	expect(band?.tokens).toEqual({ input: 100, output: 40, cacheRead: 20, cacheWrite: 0 });
	expect(band?.busyMs).toBe(0);
	expect(rows(f.csv.text)).toHaveLength(1);
	expect(f.sent).toHaveLength(1);
	expect(band?.model).toBe("anthropic/claude-x");
});

test("/resume continues the existing ledger row instead of restarting it", async () => {
	const first = setup();
	await first.tracker.startTask(first.ctx);
	first.tracker.agentStart(first.ctx);
	first.ctx.stats = { ...first.ctx.stats, input: 1100, cost: 6 };
	await first.tracker.agentEnd({}, first.ctx);
	const key = first.tracker.snapshot()?.key;

	const again = setup(first.csv.text);
	await again.tracker.startTask(again.ctx);
	expect(again.tracker.snapshot()?.key).toBe(key);
	expect(metrics.totalTokens(again.tracker.current?.band.tokens ?? metrics.NO_TOKENS)).toBeGreaterThanOrEqual(1000);
});

test("a new reset_boundary starts a new Task once", async () => {
	const f = setup();
	await f.tracker.startTask(f.ctx);
	const before = f.tracker.snapshot()?.key;
	f.ctx.branch = [{ id: "b1", type: "reset_boundary", timestamp: "2026-02-02T00:00:00.000Z" }];
	f.ctx.stats = { ...f.ctx.stats, cost: 9 };
	await f.tracker.beforeAgentStart(f.ctx);
	const after = f.tracker.snapshot()?.key;
	expect(after).toBe(metrics.taskKey("sess-0001-aaaa", Date.parse("2026-02-02T00:00:00.000Z")));
	expect(after).not.toBe(before);
	expect(f.tracker.current?.band.cost).toBe(9);
	f.ctx.stats = { ...f.ctx.stats, cost: 12 };
	await f.tracker.beforeAgentStart(f.ctx);
	expect(f.tracker.current?.band.cost).toBe(9);
});

test("a boundary already on the branch at start does not retrigger", async () => {
	const f = setup();
	f.ctx.branch = [{ id: "b0", type: "reset_boundary", timestamp: "2026-02-02T00:00:00.000Z" }];
	await f.tracker.startTask(f.ctx);
	const key = f.tracker.snapshot()?.key;
	await f.tracker.beforeAgentStart(f.ctx);
	expect(f.tracker.snapshot()?.key).toBe(key);
});

test("edit/write results classify created, reused, tests-stale; failures and local:// are ignored", async () => {
	const f = setup();
	await f.tracker.startTask(f.ctx);
	const abs = path.join(repo, "src", "a.ts");
	const edit = (details: object, isError = false) =>
		f.tracker.toolResult({ toolName: "edit", toolCallId: "e", input: {}, details, isError }, f.ctx);

	edit({ path: "src/a.ts", oldText: "", newText: "const x = helper(1);\n" });
	expect(f.tracker.current?.band.reused).toEqual(["helper"]);

	edit({ perFileResults: [{ path: "src/a.ts", oldText: "", newText: "export function fresh() {}\n" }] });
	expect(f.tracker.current?.band.created).toEqual(["fresh"]);

	edit({ path: "src/a.ts", oldText: "", newText: "export function other() {}\n" }, true);
	expect(f.tracker.current?.band.created).toEqual(["fresh"]);

	edit({ path: "src/a.ts" });
	expect(f.tracker.current?.band.created).toEqual(["fresh"]);

	await f.tracker.toolCall({ toolName: "write", toolCallId: "w1", input: { path: "local://x.ts" } }, f.ctx);
	f.tracker.toolResult(
		{ toolName: "write", toolCallId: "w1", input: { path: "local://x.ts", content: "export function nope() {}" }, isError: false },
		f.ctx,
	);
	expect(f.tracker.current?.band.created).toEqual(["fresh"]);

	f.files.set(abs, "export function keep() {}\n");
	await f.tracker.toolCall({ toolName: "write", toolCallId: "w2", input: { path: abs } }, f.ctx);
	f.tracker.toolResult(
		{ toolName: "write", toolCallId: "w2", input: { path: abs, content: "export function keep() {}\nexport function added() {}\n" }, isError: false },
		f.ctx,
	);
	expect(f.tracker.current?.band.created).toEqual(["fresh", "added"]);

	f.tracker.toolResult(
		{ toolName: "bash", toolCallId: "b", input: { command: "bun test" }, content: [{ type: "text", text: "1 fail" }], isError: true },
		f.ctx,
	);
	expect(f.tracker.current?.band.tests.state).toBe("fail");
	edit({ path: "src/a.ts", oldText: "", newText: "let y = 1;\n" });
	expect(f.tracker.current?.band.tests.state).toBe("stale");
});

test("a removed definition that is still called is reported as an open caller", async () => {
	const f = setup();
	await f.tracker.startTask(f.ctx);
	f.tracker.toolResult(
		{ toolName: "edit", toolCallId: "e", input: {}, details: { path: "src/a.ts", oldText: "export function gone() {}\n", newText: "" }, isError: false },
		f.ctx,
	);
	f.grepFor.set("gone", "src/b.ts:3:  gone();\n");
	f.tracker.agentStart(f.ctx);
	await f.tracker.agentEnd({}, f.ctx);
	expect(f.tracker.current?.band.removed).toEqual(["gone"]);
	expect(f.tracker.current?.band.openCallers).toEqual(["src/b.ts:3"]);
});
