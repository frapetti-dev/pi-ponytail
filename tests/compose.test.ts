import { beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeUpstream } from "../src/compose";
import type { Level } from "../src/types";
import { type FakeCtx, fakeCtx, fakePi } from "./helpers";

beforeAll(() => {
	process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-compose-"));
	process.env.PONYTAIL_DEFAULT_MODE = "full";
});

const setup = () => {
	const pi = fakePi();
	const changes: Level[] = [];
	const core = composeUpstream(pi, { onLevelChange: (l) => changes.push(l), openPanel: async () => {} });
	return { pi, core, changes };
};

const guard = (ctx: FakeCtx) => ctx.notes.filter((n) => n.message.includes("also installed"));

test("setLevel runs upstream's /ponytail, persists the entry and reports the change", async () => {
	const { pi, core, changes } = setup();
	const ctx = fakeCtx();
	await core.setLevel("ultra", ctx);
	expect(pi.entries).toEqual([{ type: "ponytail-mode", data: { mode: "ultra" } }]);
	expect(changes).toEqual(["ultra"]);
	expect(ctx.notes.some((n) => n.message === "Ponytail mode set to ultra.")).toBe(true);
});

test("Ruleset injection: main gets it, subagents and a duplicate copy do not (one warning)", async () => {
	const { pi } = setup();
	const main = fakeCtx();
	await pi.emit("session_start", {}, main);

	const [injected] = await pi.emit("before_agent_start", { systemPrompt: ["BASE"] }, main);
	const prompt = (injected as { systemPrompt: string[] }).systemPrompt;
	expect(prompt[0]).toBe("BASE");
	expect(prompt).toHaveLength(2);
	expect(prompt[1]).toStartWith("PONYTAIL MODE ACTIVE — level: full");

	const sub = fakeCtx({ kind: "sub", id: "s1", parentId: "main-1" });
	expect((await pi.emit("before_agent_start", { systemPrompt: ["BASE"] }, sub))[0]).toBeUndefined();

	const dup = { systemPrompt: ["BASE", prompt[1]] };
	expect((await pi.emit("before_agent_start", dup, main))[0]).toBeUndefined();
	expect((await pi.emit("before_agent_start", dup, main))[0]).toBeUndefined();
	expect(guard(main)).toHaveLength(1);
});

test("Level off injects nothing", async () => {
	const { pi } = setup();
	const ctx = fakeCtx({ level: "off" });
	await pi.emit("session_start", {}, ctx);
	expect((await pi.emit("before_agent_start", { systemPrompt: ["BASE"] }, ctx))[0]).toBeUndefined();
});
