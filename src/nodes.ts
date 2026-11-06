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
