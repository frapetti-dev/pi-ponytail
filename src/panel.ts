import { PICKABLE } from "./commands";
import { bar, button, framed, mount, text } from "./nodes";
import type { Ctx, Level } from "./types";

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
		(_ui, _theme, _kb, done) => mount((refresh) => {
			let def = deps.defaultLevel();
			let closed = false;

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
							refresh();
						})
						.catch(fail);
					return;
				}
				const level = PICKABLE.find((l) => `level-${l}` === name);
				if (level) deps.setLevel(level, ctx).then(() => refresh()).catch(fail);
			};

			const build = () => {
				const level = deps.level();
				return framed(
					[
						text("Ponytail", { role: "omp.sheet.head" }),
						text(`Level ${level} · Default Level ${def}`, { role: "omp.advisor.note" }),
						bar(PICKABLE.map((l) => button(label(l), `level-${l}`, KEY_OF[l], l === level ? { tone: "accent" } : undefined)), "levels"),
						bar([...(canDefault() ? [button(`Make ${level} default`, "default", "d")] : []), null, button("Close", "close", "esc")], "actions"),
					],
					"md",
				);
			};

			return {
				describe: build,
				handleEvent(ev) {
					if (ev.type === "action") act(ev.act);
				},
				handleKey(key) {
					if (key.id === "escape" || key.id === "q") return finish();
					const name = KEYS[key.id];
					if (name) act(name);
				},
			};
		}),
		{ overlay: true, overlayOptions: { width: "60%" } },
	);
}
