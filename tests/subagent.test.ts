import { afterEach, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordLevel, registerSubagentInjection } from "../src/subagent";
import { type FakeCtx, fakeCtx, fakePi } from "./helpers";

beforeAll(() => {
	process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-sub-"));
	process.env.PONYTAIL_DEFAULT_MODE = "full";
});
afterEach(() => {
	delete process.env.PONYTAIL_SUBAGENT_MATCHER;
});

const run = async (ctx: FakeCtx) => {
	const pi = fakePi();
	registerSubagentInjection(pi);
	const [out] = await pi.emit("before_agent_start", { systemPrompt: ["BASE"] }, ctx);
	return out as { systemPrompt: string[] } | undefined;
};

test("subagent inherits the parent's Level", async () => {
	recordLevel(fakeCtx({ id: "p1" }), "ultra");
	const out = await run(fakeCtx({ kind: "sub", id: "c1", parentId: "p1", name: "explore" }));
	expect(out?.systemPrompt[0]).toBe("BASE");
	expect(out?.systemPrompt[1]).toContain("level: ultra");
});

test("nested subagent inherits through its parent", async () => {
	recordLevel(fakeCtx({ id: "p2" }), "lite");
	await run(fakeCtx({ kind: "sub", id: "c2", parentId: "p2" }));
	const out = await run(fakeCtx({ kind: "sub", id: "g2", parentId: "c2" }));
	expect(out?.systemPrompt[1]).toContain("level: lite");
});

test("parent Level off: no injection", async () => {
	recordLevel(fakeCtx({ id: "p3" }), "off");
	expect(await run(fakeCtx({ kind: "sub", id: "c3", parentId: "p3" }))).toBeUndefined();
});

test("unknown parent falls back to the configured default", async () => {
	const out = await run(fakeCtx({ kind: "sub", id: "c4", parentId: "nope" }));
	expect(out?.systemPrompt[1]).toContain("level: full");
});

test("main agent is untouched", async () => {
	expect(await run(fakeCtx({ kind: "main" }))).toBeUndefined();
});

test("PONYTAIL_SUBAGENT_MATCHER filters by agent name; invalid regex fails open", async () => {
	recordLevel(fakeCtx({ id: "p5" }), "full");
	process.env.PONYTAIL_SUBAGENT_MATCHER = "^reviewer$";
	expect(await run(fakeCtx({ kind: "sub", id: "c5", parentId: "p5", name: "explore" }))).toBeUndefined();
	expect(await run(fakeCtx({ kind: "sub", id: "c6", parentId: "p5", name: "reviewer" }))).toBeDefined();
	process.env.PONYTAIL_SUBAGENT_MATCHER = "(";
	expect(await run(fakeCtx({ kind: "sub", id: "c7", parentId: "p5", name: "explore" }))).toBeDefined();
});
