import { type JSXNode, jsx, signal, type UiEvent } from "@oh-my-pi/pi-tui";
import { col, seg, spacer, status } from "./nodes";
import type { Ctx } from "./types";
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

export interface BandDeps {
	/** Current Band data; undefined until the first Task starts. */
	band(): BandData | undefined;
	/** Level to show while no Task exists yet. */
	level(): string;
	/** Run a non-fold action; the host owns Level picking, skills and clipboard. */
	run(act: Exclude<BandAction, "fold">): void;
}

/** The Band above the editor: a reactive node that rebuilds when `refresh` bumps its tick. */
export class BandWidget {
	#detail = false;
	#tick = signal(0);

	constructor(private readonly deps: BandDeps) {}

	get detail(): boolean {
		return this.#detail;
	}

	install(ctx: Ctx): void {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget(WIDGET_KEY, () => this.#node(), { placement: "aboveEditor" });
	}

	remove(ctx: Ctx): void {
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	refresh(): void {
		this.#tick.update((v) => v + 1);
	}

	toggleFold(): void {
		this.#detail = !this.#detail;
		this.refresh();
	}

	#view(): BandData {
		return this.deps.band() ?? emptyBand(this.deps.level());
	}

	#node(): JSXNode {
		return jsx("col", {
			children: () => {
				this.#tick();
				return this.#describe();
			},
			onEvent: (ev: UiEvent) => {
				if (ev.type !== "action") return;
				if (ev.act === "fold") this.toggleFold();
				else if (ev.act === "level" || ev.act === "review" || ev.act === "audit" || ev.act === "copy-md") this.deps.run(ev.act);
			},
		});
	}

	#describe(): JSXNode {
		const b = this.#view();
		const label = (act: BandAction) =>
			act === "level" ? `Level: ${b.level}` : act === "fold" ? (this.#detail ? "Compact" : "Details") : act === "copy-md" ? "Copy" : act === "review" ? "Review" : "Audit";
		const buttons = (b.level === "off" ? BUTTONS.slice(0, 1) : BUTTONS).map((x) =>
			seg(x.act, [{ t: label(x.act) }], { side: "right", priority: x.priority, title: x.title }, x.act),
		);
		// Segments label dim, value strong; earlier items outrank later ones when the strip is too narrow.
		const items = (id: string, list: [string, string][]) =>
			list.map(([k, v], i) => seg(`${id}.${k}`, [{ t: `${k} `, s: "dim" }, { t: v, s: "strong" }], { priority: list.length - i }));
		const off = [seg("off", [{ t: "ponytail off", s: "dim" }])];
		const rows = [status([...(b.level === "off" ? off : items("m", metricItems(b))), ...buttons])];
		if (this.#detail && b.level !== "off") rows.push(status(items("d", detailItems(b))));
		// The composer's context meter is drawn over the bottom edge of the widget; leave room for it.
		return col([...rows, spacer("md")]);
	}
}
