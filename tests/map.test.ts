import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerMap } from "../src/map";
import { mapModule } from "../src/upstream";
import { type FakeCtx, fakeCtx, fakePi } from "./helpers";

const original = mapModule.buildMap;
let calls = 0;
let impl: (root: string) => string;

beforeAll(() => {
	process.env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-map-"));
	process.env.PONYTAIL_DEFAULT_MODE = "full";
});
beforeEach(() => {
	calls = 0;
	impl = () => "Codebase map (test):\nsrc/a.ts: foo";
	mapModule.buildMap = (root) => {
		calls++;
		return impl(root);
	};
});
afterEach(() => {
	mapModule.buildMap = original;
	delete process.env.PONYTAIL_MAP;
});

const prompt = async (ctx: FakeCtx, pi = fakePi()) => {
	registerMap(pi);
	const [out] = await pi.emit("before_agent_start", { systemPrompt: ["BASE"] }, ctx);
	return (out as { systemPrompt: string[] } | undefined)?.systemPrompt;
};

test("map is built once per cwd and appended byte-identically on every prompt", async () => {
	const pi = fakePi();
	registerMap(pi);
	const ctx = fakeCtx();
	const a = (await pi.emit("before_agent_start", { systemPrompt: ["BASE"] }, ctx))[0] as { systemPrompt: string[] };
	const b = (await pi.emit("before_agent_start", { systemPrompt: ["BASE"] }, ctx))[0] as { systemPrompt: string[] };
	expect(a.systemPrompt).toEqual(["BASE", "Codebase map (test):\nsrc/a.ts: foo"]);
	expect(b.systemPrompt[1]).toBe(a.systemPrompt[1]);
	expect(calls).toBe(1);
});

test("a map already present in the prompt is not duplicated", async () => {
	const pi = fakePi();
	registerMap(pi);
	const out = await pi.emit("before_agent_start", { systemPrompt: ["BASE", "Codebase map (x):\n"] }, fakeCtx());
	expect(out[0]).toBeUndefined();
});

test("PONYTAIL_MAP=0, Level off or review, subagents: untouched, buildMap never runs", async () => {
	process.env.PONYTAIL_MAP = "0";
	expect(await prompt(fakeCtx())).toBeUndefined();
	delete process.env.PONYTAIL_MAP;
	expect(await prompt(fakeCtx({ level: "off" }))).toBeUndefined();
	expect(await prompt(fakeCtx({ level: "review" }))).toBeUndefined();
	expect(await prompt(fakeCtx({ kind: "sub", id: "s" }))).toBeUndefined();
	expect(calls).toBe(0);
});

test("a throwing or empty buildMap leaves the prompt alone", async () => {
	impl = () => {
		throw new Error("bad root");
	};
	expect(await prompt(fakeCtx())).toBeUndefined();
	impl = () => "";
	expect(await prompt(fakeCtx({ cwd: "other" }))).toBeUndefined();
});
