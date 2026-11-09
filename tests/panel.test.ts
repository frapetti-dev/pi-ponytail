import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ponytail from "../extensions/index";
import type { Node } from "../src/nodes";
import { type FakeCtx, type FakePi, fakeCtx, fakePi } from "./helpers";

let configFile: string;

beforeEach(() => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-panel-"));
	process.env.XDG_CONFIG_HOME = dir;
	delete process.env.PONYTAIL_DEFAULT_MODE;
	configFile = path.join(dir, "ponytail", "config.json");
});

const walk = (n: Node, out: Node[] = []): Node[] => {
	out.push(n);
	for (const c of n.c ?? []) walk(c, out);
	return out;
};
const tree = (ctx: FakeCtx) => ctx.overlay?.describe?.({ cols: 120, dark: true }) as Node;
// The panel fires async actions without returning them; drain the microtask queue so their effects land.
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};
const find = (ctx: FakeCtx, key: string) => walk(tree(ctx)).find((n) => n.key === key);
const texts = (ctx: FakeCtx) => walk(tree(ctx)).flatMap((n) => (typeof n.p?.text === "string" ? [n.p.text] : []));
const lastMode = (pi: FakePi) => (pi.entries.at(-1)?.data as { mode: string } | undefined)?.mode;
const open = (pi: FakePi, ctx: FakeCtx) => {
	ponytail(pi);
	return pi.commands.get("ponytail")!.handler("", ctx) as Promise<void>;
};

test("bare /ponytail opens the Panel; click and key both switch the Level; Esc closes", async () => {
	const pi = fakePi();
	const ctx = fakeCtx();
	const opened = open(pi, ctx);
	expect(ctx.overlay).toBeDefined();
	expect(ctx.overlayOptions).toEqual({ overlay: true, overlayOptions: { width: "60%" } });
	expect(pi.entries).toEqual([]);
	expect(tree(ctx)).toBe(tree(ctx));

	ctx.overlay!.handleNativeEvent?.({ type: "action", key: "frame/inset/content/levels/level-ultra", act: "level-ultra" });
	await flush();
	expect(pi.entries.at(-1)).toEqual({ type: "ponytail-mode", data: { mode: "ultra" } });
	expect(find(ctx, "level-ultra")?.p?.tone).toBe("accent");

	ctx.overlay!.handleInput?.("l");
	await flush();
	expect(lastMode(pi)).toBe("lite");

	ctx.overlay!.handleInput?.("\x1b");
	await opened;
	expect(ctx.overlay).toBeUndefined();
});

test("Make default writes config.json and then hides itself", async () => {
	const pi = fakePi();
	const ctx = fakeCtx();
	const opened = open(pi, ctx);
	ctx.overlay!.handleInput?.("u");
	await flush();
	expect(find(ctx, "default")).toBeDefined();

	ctx.overlay!.handleInput?.("d");
	await flush();
	expect(JSON.parse(fs.readFileSync(configFile, "utf8")).defaultMode).toBe("ultra");
	expect(find(ctx, "default")).toBeUndefined();
	expect(texts(ctx).some((t) => t.includes("Default Level ultra"))).toBe(true);

	ctx.overlay!.handleInput?.("q");
	await opened;
});

test("arguments and headless sessions bypass the Panel", async () => {
	const pi = fakePi();
	ponytail(pi);
	const handler = pi.commands.get("ponytail")!.handler;
	const ctx = fakeCtx();
	await handler("ultra", ctx);
	expect(ctx.overlay).toBeUndefined();
	expect(lastMode(pi)).toBe("ultra");

	const headless = fakeCtx({ hasUI: false, level: "off" });
	await handler("", headless);
	expect(headless.overlay).toBeUndefined();
	expect(headless.notes.length).toBeGreaterThan(0);
});
