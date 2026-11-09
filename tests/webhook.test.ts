import { afterEach, expect, test } from "bun:test";
import { metrics } from "../src/upstream";
import { createWebhook } from "../src/webhook";
import { fakeCtx } from "./helpers";

const row = metrics.snapshot(
	{
		level: "full",
		model: "p/m",
		cost: 1,
		spent: 1,
		turns: 1,
		turnCosts: [1],
		tokens: metrics.NO_TOKENS,
		busyMs: 0,
		name: "secret task",
		project: "proj",
		session: "sess-0001",
		reused: [],
		created: [],
		removed: [],
		openCallers: [],
		tests: { state: "none" },
	},
	0,
);

interface Received {
	auth: string | null;
	body: { name: string };
}

let server: { stop(force?: boolean): unknown } | undefined;
afterEach(() => {
	server?.stop(true);
	server = undefined;
});

/** Local listener; `next()` resolves with the next request the webhook delivers. */
function listen() {
	const waiting: ((r: Received) => void)[] = [];
	const queued: Received[] = [];
	const s = Bun.serve({
		port: 0,
		fetch: async (r) => {
			const got: Received = { auth: r.headers.get("authorization"), body: await r.json() };
			const w = waiting.shift();
			if (w) w(got);
			else queued.push(got);
			return new Response("ok");
		},
	});
	server = s;
	const next = () => {
		const q = queued.shift();
		if (q) return Promise.resolve(q);
		const { promise, resolve } = Promise.withResolvers<Received>();
		waiting.push(resolve);
		return promise;
	};
	return { next, url: `http://127.0.0.1:${s.port}/t` };
}

test("plain http to a non-local host is refused without any request", async () => {
	const ctx = fakeCtx();
	await createWebhook(async () => ({ webhookUrl: "http://example.com/x" }))(row, ctx);
	expect(ctx.statuses.get("ponytail-band")).toBe("ponytail band: webhook needs https");
});

test("local http posts with the bearer token; sendNames:false blanks the Task name", async () => {
	const { next, url } = listen();
	const ctx = fakeCtx();
	await createWebhook(async () => ({ webhookUrl: url, webhookToken: "tok" }))(row, ctx);
	const first = await next();
	expect(first.auth).toBe("Bearer tok");
	expect(first.body.name).toBe("secret task");

	await createWebhook(async () => ({ webhookUrl: url, sendNames: false }))(row, ctx);
	expect((await next()).body.name).toBe("");
});

test("no URL: silent; unavailable settings: one warning per session", async () => {
	const ctx = fakeCtx();
	const send = createWebhook(async () => {
		throw new Error("no loader");
	});
	await send(row, ctx);
	await send(row, ctx);
	expect(ctx.notes.filter((n) => n.message.includes("settings unavailable"))).toHaveLength(1);
	expect(ctx.statuses.size).toBe(0);
});
