import { beforeEach, expect, test } from "bun:test";
import type { UiNode } from "@oh-my-pi/pi-tui";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ponytail from "../extensions/index";
import { act, type FakeCtx, type FakePi, fakeCtx, fakePi, k } from "./helpers";

let configFile: string;

beforeEach(() => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-panel-"));
	process.env.XDG_CONFIG_HOME = dir;
	delete process.env.PONYTAIL_DEFAULT_MODE;
	configFile = path.join(dir, "ponytail", "config.json");
});

const walk = (n: UiNode, out: UiNode[] = []): UiNode[] => {
	out.push(n);
	for (const c of n.children()) walk(c, out);
	return out;
};
const props = (n: UiNode) => n.props() as { text?: string; tone?: string };
const tree = (ctx: FakeCtx) => ctx.overlay!.children()[0]!;
const key = (ctx: FakeCtx, id: string) => ctx.overlay!.handlers.onKey!(k(id));
// The panel fires async actions without returning them; drain the microtask queue so their effects land.
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};
const find = (ctx: FakeCtx, key: string) => walk(tree(ctx)).find((n) => n.key() === key);
const texts = (ctx: FakeCtx) => walk(tree(ctx)).flatMap((n) => (typeof props(n).text === "string" ? [props(n).text as string] : []));
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
	expect(texts(ctx)).toContain("Ponytail");

	ctx.overlay!.handlers.onEvent!(act("level-ultra", "frame/inset/content/levels/level-ultra"));
	await flush();
	expect(pi.entries.at(-1)).toEqual({ type: "ponytail-mode", data: { mode: "ultra" } });
	expect(props(find(ctx, "level-ultra")!).tone).toBe("accent");

	key(ctx, "l");
	await flush();
	expect(lastMode(pi)).toBe("lite");

	key(ctx, "escape");
	await opened;
	expect(ctx.overlay).toBeUndefined();
});

test("Make default writes config.json and then hides itself", async () => {
	const pi = fakePi();
	const ctx = fakeCtx();
	const opened = open(pi, ctx);
	key(ctx, "u");
	await flush();
	expect(find(ctx, "default")).toBeDefined();

	key(ctx, "d");
	await flush();
	expect(JSON.parse(fs.readFileSync(configFile, "utf8")).defaultMode).toBe("ultra");
	expect(find(ctx, "default")).toBeUndefined();
	expect(texts(ctx).some((t) => t.includes("Default Level ultra"))).toBe(true);

	key(ctx, "q");
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
