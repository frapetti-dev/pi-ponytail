/** pi-tui node builders and `mount`, the bridge to `ctx.ui.custom`. Value imports from the @oh-my-pi/pi-tui root only. */
import { type JSXNode, jsx, type KeyEvent, signal, type UiEvent } from "@oh-my-pi/pi-tui";
import type { TspKind, TspProps, TspSpan } from "@oh-my-pi/pi-wire";

/** A focused view: its tree plus its input handlers. */
export interface View {
	describe(): JSXNode;
	handleKey(key: KeyEvent): void;
	handleEvent?(e: UiEvent): void;
}

/** Root node for ctx.ui.custom: rebuilds `describe()` whenever `refresh` runs; routes keys and events to the view. */
export function mount(build: (refresh: () => void) => View): JSXNode {
	const tick = signal(0);
	const view = build(() => tick.update((v) => v + 1));
	return jsx("col", {
		children: () => {
			tick();
			return view.describe();
		},
		onKey: (key: KeyEvent) => {
			if (key.kind === "release") return false;
			view.handleKey(key);
			return true;
		},
		onEvent: (e: UiEvent) => view.handleEvent?.(e),
	});
}

export const node = <K extends TspKind>(k: K, p?: TspProps<K>, c?: readonly JSXNode[], key?: string): JSXNode =>
	jsx(k, c === undefined ? { ...p } : { ...p, children: c }, key) as JSXNode;

export const text = (s: string, p?: TspProps<"text">): JSXNode => node("text", { ...p, text: s });

export const col = (c: readonly JSXNode[], p?: TspProps<"col">): JSXNode => node("col", p, c);

/** `status` strip: sans face, segments drop by priority instead of overflowing or wrapping. */
export const status = (c: readonly JSXNode[]): JSXNode => node("status", { transparent: true }, c);

export const spacer = (size: "xs" | "sm" | "md" | "lg"): JSXNode => node("spacer", { size });

/** No padding prop: spacers and an inset row frame the content instead. */
export function framed(kids: readonly JSXNode[], gap: "sm" | "md" | "lg"): JSXNode {
	const side = (key: string) => node("spacer", { min: { w: "2ch" } }, undefined, key);
	const inset = node("row", { align: "start" }, [side("left"), node("col", { gap, grow: 1 }, kids, "content"), side("right")], "inset");
	return node(
		"col",
		{ gap: "none" },
		[node("spacer", { size: "sm" }, undefined, "top"), inset, node("spacer", { size: "sm" }, undefined, "bottom")],
		"frame",
	);
}

export function button(label: string, act: string, keys?: string, p?: TspProps<"row">): JSXNode {
	return node(
		"row",
		{ role: "omp.btn", gap: "xs", align: "center", actions: { click: act }, title: label, ...p },
		[text(label), ...(keys ? [node("kbd", { keys: keys.split("+") })] : [])],
		act,
	);
}

/** Action row; a null item becomes a flexible spacer that pushes the rest to the right. */
export function bar(items: readonly (JSXNode | null)[], key: string): JSXNode {
	return node("row", { role: "omp.actions", gap: "sm", align: "center" }, items.map((b) => b ?? node("spacer", { grow: 1 })), key);
}

/** Status segment; `act` makes it a button and doubles as the key so the event key ends in it. */
export const seg = (key: string, spans: readonly TspSpan[], p?: TspProps<"seg">, act?: string): JSXNode =>
	node("seg", { spans, ...p, ...(act ? { actions: { click: act } } : {}) }, undefined, key);
