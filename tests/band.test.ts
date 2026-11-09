import { beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BandWidget } from "../src/band";
import { BandController } from "../src/commands";
import type { Node } from "../src/nodes";
import { TaskTracker } from "../src/task";
import type { Level, Theme, Tui, WidgetComponent, WidgetFactory } from "../src/types";
import { type FakeCtx, type FakePi, fakeCtx, fakePi } from "./helpers";

const theme: Theme = { fg: (_c, t) => t };
let renders = 0;
const tui: Tui = { requestRender: () => void renders++ };
let configFile: string;

beforeEach(() => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponytail-band-"));
	process.env.XDG_CONFIG_HOME = dir;
	configFile = path.join(dir, "ponytail", "config.json");
	renders = 0;
});

const idleHost = {
	exec: async () => ({ stdout: "", code: 1 }),
	readFile: async () => undefined,
	now: () => 0,
	readLedger: async () => "",
	writeLedger: async () => {},
	sendWebhook: async () => {},
};

function setup(level: Level = "full") {
	const ran: string[] = [];
	let panels = 0;
	const levels: Level[] = [];
	const pi = fakePi();
	const tracker = new TaskTracker(idleHost, () => {});
	const widget: BandWidget = new BandWidget({ band: () => tracker.current?.band, level: () => level, run: (a) => controller.run(a) });
	const controller = new BandController(pi, { setLevel: async (l) => void levels.push(l), openPanel: async () => void panels++ }, tracker, widget);
	controller.register();
	const ctx = fakeCtx();
	controller.attach(ctx);
	const factory = ctx.widgets.get("ponytail-band") as WidgetFactory | undefined;
	const comp = factory?.(tui, theme) as WidgetComponent;
	return { pi, ctx, widget, controller, comp, ran, levels, panels: () => panels };
}

const walk = (n: Node, out: Node[] = []): Node[] => {
	out.push(n);
	for (const c of n.c ?? []) walk(c, out);
	return out;
};
const describe = (c: WidgetComponent) => c.describe?.({ cols: 120, dark: true }) as Node;
const keys = (n: Node) => walk(n).flatMap((x) => (x.key ? [x.key] : []));
const texts = (n: Node) => walk(n).flatMap((x) => (typeof x.p?.text === "string" ? [x.p.text] : []));
const action = (c: WidgetComponent, act: string) => c.handleNativeEvent?.({ type: "action", key: `actions/${act}` });
const run = (pi: FakePi, args: string, ctx: FakeCtx) => pi.commands.get("ponytail-band")?.handler(args, ctx);

test("compact Band shows zeros before the first turn and the five buttons", () => {
	const { comp } = setup();
	const tree = describe(comp);
	expect(keys(tree).filter((k) => !k.startsWith("m."))).toEqual(["level", "review", "audit", "copy-md", "fold"]);
	expect(walk(tree).filter((n) => n.key?.startsWith("m.")).map((n) => JSON.stringify(n.p?.spans))).toEqual([
		'[{"t":"cost ","s":"dim"},{"t":"$0.00","s":"strong"}]',
		'[{"t":"tokens ","s":"dim"},{"t":"0","s":"strong"}]',
		'[{"t":"turns ","s":"dim"},{"t":"0","s":"strong"}]',
		'[{"t":"time ","s":"dim"},{"t":"0s","s":"strong"}]',
		'[{"t":"reuse ","s":"dim"},{"t":"–","s":"strong"}]',
		'[{"t":"tests ","s":"dim"},{"t":"not run","s":"strong"}]',
	]);
	expect(JSON.stringify(tree)).toContain('"Level: full"');
});

test("fold toggles the detail line and the button label; memo is stable until refresh", () => {
	const { comp, widget } = setup();
	const a = describe(comp);
	expect(describe(comp)).toBe(a);
	action(comp, "fold");
	const b = describe(comp);
	expect(b).not.toBe(a);
	expect(widget.detail).toBe(true);
	expect(JSON.stringify(b)).toContain('"t":"last turn ","s":"dim"},{"t":"–"');
	expect(JSON.stringify(b)).toContain('"Compact"');
	widget.refresh();
	expect(describe(comp)).not.toBe(b);
	expect(renders).toBeGreaterThan(0);
});

test("ANSI lines never exceed the width and end with an ellipsis when cut", () => {
	const { comp } = setup();
	action(comp, "fold");
	for (const line of comp.render(40)) {
		expect(line.length).toBeLessThanOrEqual(40);
	}
	const first = comp.render(20)[0] ?? "";
	expect(first).toHaveLength(20);
	expect(first.endsWith("…")).toBe(true);
	expect(comp.render(200)[0]?.endsWith("…")).toBe(false);
});

test("Level off: one dim strip with only the Level button", () => {
	const { comp } = setup("off");
	const tree = describe(comp);
	expect(keys(tree)).toEqual(["off", "level"]);
	expect(JSON.stringify(tree)).toContain('"ponytail off"');
	expect(comp.render(80)).toEqual(["ponytail off"]);
});

test("the Level button opens the Panel; /ponytail-band level lite switches directly", async () => {
	const { controller, pi, ctx, levels, panels } = setup();
	await controller.run("level");
	expect(panels()).toBe(1);
	expect(levels).toEqual([]);
	await run(pi, "level lite", ctx);
	expect(levels).toEqual(["lite"]);
	expect(panels()).toBe(1);
});

test("/ponytail-band off removes the widget and persists bandHidden, keeping other keys", async () => {
	const { pi, ctx } = setup();
	fs.mkdirSync(path.dirname(configFile), { recursive: true });
	fs.writeFileSync(configFile, JSON.stringify({ defaultMode: "ultra" }));
	await run(pi, "off", ctx);
	expect(ctx.widgets.get("ponytail-band")).toBeUndefined();
	expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toEqual({ defaultMode: "ultra", bandHidden: true });
});

test("invalid config.json is left untouched with an error notification", async () => {
	const { pi, ctx } = setup();
	fs.mkdirSync(path.dirname(configFile), { recursive: true });
	fs.writeFileSync(configFile, "{nope");
	await run(pi, "off", ctx);
	expect(fs.readFileSync(configFile, "utf8")).toBe("{nope");
	expect(ctx.notes.at(-1)).toEqual({ message: "ponytail band: config.json is not valid JSON; not changed", type: "error" });
	expect(ctx.widgets.get("ponytail-band")).toBeDefined();
});

test("a hidden Band stays hidden on the next session attach; unknown subcommand prints usage", async () => {
	const { pi, ctx, controller } = setup();
	await run(pi, "off", ctx);
	const fresh = fakeCtx();
	controller.attach(fresh);
	expect(fresh.widgets.size).toBe(0);
	await run(pi, "bogus", ctx);
	expect(ctx.notes.at(-1)?.type).toBe("warning");
});

test("review sends the skill body without frontmatter, queued as follow-up while busy", async () => {
	const { pi, ctx } = setup();
	await run(pi, "review", ctx);
	expect(pi.sent[0]?.content.startsWith("---")).toBe(false);
	expect(pi.sent[0]?.content.length).toBeGreaterThan(50);
	expect(pi.sent[0]?.options).toBeUndefined();
	ctx.isIdle = () => false;
	await run(pi, "audit", ctx);
	expect(pi.sent[1]?.options).toEqual({ deliverAs: "followUp" });
});
