import fs from "node:fs/promises";
import path from "node:path";
import type { BandAction, BandWidget } from "./band";
import { emptyBand } from "./band";
import type { TaskTracker } from "./task";
import type { Ctx, Level, Pi } from "./types";
import { metrics, root } from "./upstream";
import { readBandHidden, writeBandHidden } from "./visibility";

export const PICKABLE: Level[] = ["off", "lite", "full", "ultra"];
const SUBCOMMANDS = ["on", "off", "level", "level off", "level lite", "level full", "level ultra", "review", "audit", "copy", "fold"];
const USAGE = "Usage: /ponytail-band [on|off|level [off|lite|full|ultra]|review|audit|copy|fold]";

type Skill = "ponytail-review" | "ponytail-audit";

/** Wires the Band's buttons and `/ponytail-band` to the same actions. */
export class BandController {
	#hidden = readBandHidden();
	#ctx: Ctx | undefined;

	constructor(
		private readonly pi: Pi,
		private readonly core: { setLevel(level: Level, ctx: Ctx): Promise<void>; openPanel(ctx: Ctx): Promise<void> },
		private readonly tracker: TaskTracker,
		private readonly widget: BandWidget,
	) {}

	/** Last main-session context; buttons have no ctx of their own. */
	set ctx(ctx: Ctx) {
		this.#ctx = ctx;
	}

	/** (Re)assert the widget for a session; the hidden flag is re-read so a restart honours `/ponytail-band off`. */
	attach(ctx: Ctx): void {
		this.#ctx = ctx;
		this.#hidden = readBandHidden();
		if (!this.#hidden) this.widget.install(ctx);
		this.widget.refresh();
	}

	detach(ctx: Ctx): void {
		this.widget.remove(ctx);
	}

	/** Button entry point (the handler returns void, so failures surface as notifications). */
	run(act: Exclude<BandAction, "fold">): Promise<void> {
		const ctx = this.#ctx;
		if (!ctx) return Promise.resolve();
		const done =
			act === "level" ? this.pickLevel(ctx) : act === "copy-md" ? this.copyBand(ctx) : this.sendSkill(act === "review" ? "ponytail-review" : "ponytail-audit", ctx);
		return done.catch((e) => ctx.ui.notify(e instanceof Error ? e.message : String(e), "error"));
	}

	async pickLevel(ctx: Ctx, arg?: string): Promise<void> {
		const level = PICKABLE.find((l) => l === arg);
		await (level ? this.core.setLevel(level, ctx) : this.core.openPanel(ctx));
	}

	/** Sends the skill body itself: omp's sendUserMessage does not expand `/skill:` text. */
	async sendSkill(name: Skill, ctx: Ctx): Promise<void> {
		const raw = await fs.readFile(path.join(root, "skills", name, "SKILL.md"), "utf8");
		const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
		this.pi.sendUserMessage(body, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
	}

	async copyBand(ctx: Ctx): Promise<void> {
		const row = this.tracker.snapshot() ?? metrics.snapshot(emptyBand("full"), Date.now());
		try {
			// Dynamic by necessity: a host export, absent from the plugin's own dependency graph.
			const { copyToClipboard } = await import("@oh-my-pi/pi-coding-agent");
			await copyToClipboard(metrics.markdown(row));
		} catch {
			ctx.ui.notify("Clipboard unavailable", "error");
			return;
		}
		ctx.ui.notify("Band copied as Markdown", "info");
	}

	register(): void {
		this.pi.registerCommand("ponytail-band", {
			description: "Ponytail Band: on|off|level [lite|full|ultra|off]|review|audit|copy|fold",
			getArgumentCompletions: (prefix) => {
				const typed = prefix.trimStart();
				const hits = SUBCOMMANDS.filter((s) => s.startsWith(typed));
				return hits.length ? hits.map((value) => ({ value, label: value })) : null;
			},
			handler: (args, ctx) => this.#command(args, ctx),
		});
	}

	async #command(args: string, ctx: Ctx): Promise<void> {
		this.#ctx = ctx;
		const [sub = "", arg] = args.trim().split(/\s+/);
		switch (sub) {
			case "":
				ctx.ui.notify(`Band: ${this.#hidden ? "hidden" : "shown"} · ${this.widget.detail ? "detail" : "compact"} · level ${this.tracker.current?.band.level ?? "–"}`, "info");
				return;
			case "on":
			case "off": {
				const hide = sub === "off";
				const res = writeBandHidden(hide);
				if (!res.ok) {
					ctx.ui.notify(`ponytail band: ${res.error}`, "error");
					return;
				}
				this.#hidden = hide;
				if (hide) this.widget.remove(ctx);
				else this.widget.install(ctx);
				return;
			}
			case "level":
				return this.pickLevel(ctx, arg);
			case "review":
				return this.sendSkill("ponytail-review", ctx);
			case "audit":
				return this.sendSkill("ponytail-audit", ctx);
			case "copy":
				return this.copyBand(ctx);
			case "fold":
				this.widget.toggleFold();
				return;
			default:
				ctx.ui.notify(USAGE, "warning");
		}
	}
}
