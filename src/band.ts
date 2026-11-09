import { col, fit, Memo, type Node, seg, spacer, status } from "./nodes";
import type { Ctx, Theme, Tui, WidgetComponent } from "./types";
import { type BandData, metrics } from "./upstream";

export const WIDGET_KEY = "ponytail-band";

export type BandAction = "level" | "review" | "audit" | "copy-md" | "fold";

const BUTTONS: { act: BandAction; title: string; priority: number }[] = [
	{ act: "level", title: "Open the Ponytail panel", priority: 100 },
	{ act: "review", title: "Run the ponytail review skill", priority: 50 },
	{ act: "audit", title: "Run the ponytail audit skill", priority: 40 },
	{ act: "copy-md", title: "Copy the Band as Markdown", priority: 30 },
	{ act: "fold", title: "Show or hide details", priority: 60 },
];

const dollars = (n: number) => `$${n.toFixed(2)}`;

/** Before the first turn the Band reads as zeros rather than disappearing. */
export function emptyBand(level: string): BandData {
	return {
		level,
		model: "",
		cost: 0,
		spent: 0,
		turns: 0,
		turnCosts: [],
		tokens: metrics.NO_TOKENS,
		busyMs: 0,
		name: "",
		project: "",
		session: "",
		reused: [],
		created: [],
		removed: [],
		openCallers: [],
		tests: { state: "none" },
	};
}

export function metricItems(b: BandData): [string, string][] {
	const reuse = metrics.percent(b.reused.length, b.created.length);
	return [
		["cost", dollars(b.spent)],
		["tokens", metrics.fmtTokens(metrics.totalTokens(b.tokens))],
		["turns", String(b.turns)],
		["time", metrics.elapsed(b.busyMs)],
		["reuse", reuse === undefined ? "–" : `${reuse}%`],
		["tests", metrics.testsLabel(b.tests)],
	];
}

export function detailItems(b: BandData): [string, string][] {
	const last = b.turnCosts[b.turnCosts.length - 1];
	const t = b.tokens;
	return [
		["model", b.model || "–"],
		["last turn", last === undefined ? "–" : dollars(last)],
		["avg / turn", dollars(b.turns > 0 ? b.spent / b.turns : 0)],
		["in", metrics.fmtTokens(t.input)],
		["out", metrics.fmtTokens(t.output)],
		["cache r", metrics.fmtTokens(t.cacheRead)],
		["cache w", metrics.fmtTokens(t.cacheWrite)],
		["callers open", String(b.openCallers.length)],
		["new / reused", `${b.created.length} / ${b.reused.length}`],
		["project", b.project || "–"],
	];
}

const joinItems = (items: [string, string][]) => items.map(([k, v]) => `${k} ${v}`).join(" · ");

export const metricsLine = (b: BandData) => `ponytail ${b.level} · ${joinItems(metricItems(b))}`;

export const detailLine = (b: BandData) => joinItems(detailItems(b));

export interface BandDeps {
	/** Current Band data; undefined until the first Task starts. */
	band(): BandData | undefined;
	/** Level to show while no Task exists yet. */
	level(): string;
	/** Run a non-fold action; the host owns Level picking, skills and clipboard. */
	run(act: Exclude<BandAction, "fold">): void;
}

/** The Band above the editor: one component serving both Tern (describe) and ANSI (render). */
export class BandWidget {
	#detail = false;
	#version = 0;
	#installed = false;
	#tui: Tui | undefined;
	#memo = new Memo<Node>();

	constructor(private readonly deps: BandDeps) {}

	get detail(): boolean {
		return this.#detail;
	}

	get installed(): boolean {
		return this.#installed;
	}

	install(ctx: Ctx): void {
		if (this.#installed || !ctx.hasUI) return;
		this.#installed = true;
		ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => this.#component(tui, theme), { placement: "aboveEditor" });
	}

	remove(ctx: Ctx): void {
		this.#installed = false;
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	refresh(): void {
		this.#version++;
		this.#tui?.requestRender();
	}

	toggleFold(): void {
		this.#detail = !this.#detail;
		this.refresh();
	}

	#view(): BandData {
		return this.deps.band() ?? emptyBand(this.deps.level());
	}

	#describe(cols: number, dark: boolean): Node {
		return this.#memo.get([this.#version, dark, cols], () => {
			const b = this.#view();
			const label = (act: BandAction) =>
				act === "level" ? `Level: ${b.level}` : act === "fold" ? (this.#detail ? "Compact" : "Details") : act === "copy-md" ? "Copy" : act === "review" ? "Review" : "Audit";
			const buttons = (b.level === "off" ? BUTTONS.slice(0, 1) : BUTTONS).map((x) =>
				seg(x.act, [label(x.act)], { side: "right", priority: x.priority, title: x.title }, x.act),
			);
			// Segments label dim, value strong; earlier items outrank later ones when the strip is too narrow.
			const items = (id: string, list: [string, string][]) =>
				list.map(([k, v], i) => seg(`${id}.${k}`, [{ t: `${k} `, s: "dim" }, { t: v, s: "strong" }], { priority: list.length - i }));
			const off = [seg("off", [{ t: "ponytail off", s: "dim" }])];
			const rows = [status([...(b.level === "off" ? off : items("m", metricItems(b))), ...buttons])];
			if (this.#detail && b.level !== "off") rows.push(status(items("d", detailItems(b))));
			// The composer's context meter is drawn over the bottom edge of the widget; leave room for it.
			return col([...rows, spacer("md")]);
		});
	}

	#lines(): { lines: string[]; dim: boolean } {
		const b = this.#view();
		if (b.level === "off") return { lines: ["ponytail off"], dim: true };
		const lines = [metricsLine(b)];
		if (this.#detail) lines.push(detailLine(b), "/ponytail-band level|review|audit|copy|fold");
		return { lines, dim: false };
	}

	#component(tui: Tui, theme: Theme): WidgetComponent {
		this.#tui = tui;
		return {
			render: (width) => {
				const { lines, dim } = this.#lines();
				// Truncate the plain text first: styling adds escape codes that must not count toward the width.
				return lines.map((l, i) => theme.fg(dim || i === 2 ? "dim" : "muted", fit(l, width)));
			},
			describe: (cx) => this.#describe(cx.cols, cx.dark),
			handleNativeEvent: (ev) => {
				if (ev.type !== "action" || typeof ev.key !== "string") return;
				const act = ev.key.slice(ev.key.lastIndexOf("/") + 1);
				if (act === "fold") this.toggleFold();
				else if (act === "level" || act === "review" || act === "audit" || act === "copy-md") this.deps.run(act);
			},
			invalidate: () => {},
			dispose: () => {
				this.#tui = undefined;
				this.#installed = false;
			},
		};
	}
}
