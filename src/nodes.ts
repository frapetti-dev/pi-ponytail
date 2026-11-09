/** Plain-object Tern node builders; same shapes omp's own builders produce, without importing host code. */

export interface Node {
	k: string;
	p?: Record<string, unknown>;
	c?: Node[];
	key?: string;
}

export const node = (k: string, p?: Record<string, unknown>, c?: Node[], key?: string): Node => ({ k, p, c, key });

export const text = (s: string, p?: Record<string, unknown>): Node => node("text", { ...p, text: s });

export const row = (c: Node[], p?: Record<string, unknown>): Node => node("row", p, c);

export const col = (c: Node[], p?: Record<string, unknown>): Node => node("col", p, c);

/** Tern `status` strip: sans face, segments drop by priority instead of overflowing or wrapping. */
export const status = (c: Node[]): Node => node("status", { transparent: true }, c);

export const spacer = (size: "xs" | "sm" | "md" | "lg"): Node => node("spacer", { size });

export const fit = (s: string, width: number) => (s.length > width ? `${s.slice(0, Math.max(1, width - 1))}…` : s);

/** TSP has no padding prop: spacers and an inset row frame the content instead. */
export function framed(kids: Node[], gap: "sm" | "md" | "lg"): Node {
	const side = (key: string) => node("spacer", { min: { w: "2ch" } }, undefined, key);
	const inset = node("row", { align: "start" }, [side("left"), node("col", { gap, grow: 1 }, kids, "content"), side("right")], "inset");
	return node(
		"col",
		{ gap: "none" },
		[node("spacer", { size: "sm" }, undefined, "top"), inset, node("spacer", { size: "sm" }, undefined, "bottom")],
		"frame",
	);
}

export function button(label: string, act: string, keys?: string, p?: Record<string, unknown>): Node {
	return node(
		"row",
		{ role: "omp.btn", gap: "xs", align: "center", actions: { click: act }, title: label, ...p },
		[text(label), ...(keys ? [node("kbd", { keys: keys.split("+") })] : [])],
		act,
	);
}

/** Action row; a null item becomes a flexible spacer that pushes the rest to the right. */
export function bar(items: (Node | null)[], key: string): Node {
	return node("row", { role: "omp.actions", gap: "sm", align: "center" }, items.map((b) => b ?? node("spacer", { grow: 1 })), key);
}

/** Status segment; `act` makes it a button and doubles as the key so the event key ends in it. */
export const seg = (key: string, spans: unknown[], p?: Record<string, unknown>, act?: string): Node =>
	node("seg", { spans, ...p, ...(act ? { actions: { click: act } } : {}) }, undefined, key);

/** Rebuilds only when a dependency changes (Object.is), so describe() returns a stable node between renders. */
export class Memo<T> {
	#deps: readonly unknown[] | undefined;
	#value: T | undefined;

	get(deps: readonly unknown[], build: () => T): T {
		if (this.#deps && this.#value !== undefined && deps.length === this.#deps.length && deps.every((d, i) => Object.is(d, this.#deps?.[i]))) {
			return this.#value;
		}
		this.#value = build();
		this.#deps = deps;
		return this.#value;
	}
}
