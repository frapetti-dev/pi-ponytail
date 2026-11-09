import { PICKABLE } from "./commands";
import { bar, button, fit, framed, Memo, type Node, text } from "./nodes";
import type { Ctx, Level, OverlayComponent } from "./types";

export interface PanelDeps {
	/** Current Level; cheap. */
	level(): Level;
	/** Default Level; reads config, so call only at open and after `setDefault`. */
	defaultLevel(): string;
	setLevel(level: Level, ctx: Ctx): Promise<void>;
	setDefault(level: Level, ctx: Ctx): Promise<void>;
}

const KEYS: Record<string, string> = { o: "level-off", l: "level-lite", f: "level-full", u: "level-ultra", d: "default" };
const KEY_OF: Record<string, string> = { off: "o", lite: "l", full: "f", ultra: "u" };
const label = (l: string) => l[0].toUpperCase() + l.slice(1);

/** The Panel: shows the Level and Default Level, switches either, stays open until Esc/q/Close. */
export function openPanel(ctx: Ctx, deps: PanelDeps): Promise<void> {
	return ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			let def = deps.defaultLevel();
			let closed = false;
			const memo = new Memo<Node>();

			// `review` is not a valid default upstream; hide the button when the Level already is the default.
			const canDefault = () => PICKABLE.includes(deps.level()) && deps.level() !== def;
			const finish = () => {
				if (closed) return;
				closed = true;
				done(undefined);
			};
			const fail = (e: unknown) => ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");

			const act = (name: string) => {
				if (name === "close") return finish();
				if (name === "default" && canDefault()) {
					deps
						.setDefault(deps.level(), ctx)
						.then(() => {
							def = deps.defaultLevel();
							tui.requestRender();
						})
						.catch(fail);
					return;
				}
				const level = PICKABLE.find((l) => `level-${l}` === name);
				if (level) deps.setLevel(level, ctx).then(() => tui.requestRender()).catch(fail);
			};

			const build = (): Node => {
				const level = deps.level();
				return framed(
					[
						text(`Level ${level} · Default Level ${def}`, { role: "omp.advisor.note" }),
						bar(PICKABLE.map((l) => button(label(l), `level-${l}`, KEY_OF[l], l === level ? { tone: "accent" } : undefined)), "levels"),
						bar([...(canDefault() ? [button(`Make ${level} default`, "default", "d")] : []), null, button("Close", "close", "esc")], "actions"),
					],
					"md",
				);
			};

			return {
				nativeOverlay: { role: "omp.overlay.ponytail", head: "Ponytail" },
				describe: () => memo.get([deps.level(), def], build),
				handleNativeEvent(ev) {
					if (ev.type === "action" && typeof ev.act === "string") act(ev.act);
				},
				handleInput(data) {
					// shortcut: raw legacy + kitty Escape only (pi-tui's matchesKey is not installed here), switch to matchesKey if other encodings show up.
					if (data === "\x1b" || data === "\x1b[27u" || data === "q") return finish();
					const name = KEYS[data];
					if (name) act(name);
				},
				render(width) {
					const level = deps.level();
					const rows = [
						`Ponytail · Level ${level} · Default Level ${def}`,
						PICKABLE.map((l) => `${KEY_OF[l]} ${l}${l === level ? "*" : ""}`).join("  "),
						canDefault() ? `d make ${level} default · esc close` : "esc close",
					];
					return rows.map((r) => theme.fg("muted", fit(r, width)));
				},
				invalidate() {},
				dispose() {},
			};
		},
		{ overlay: true, overlayOptions: { width: "60%" } },
	);
}
