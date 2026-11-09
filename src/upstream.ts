import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Ctx, Level, SessionEntryLike } from "./types";

const NAME = "@dietrichgebert/ponytail";

/** Directory of the installed upstream package, found by walking up `node_modules` from this file. `require.resolve` fails under omp's extension loader. */
export function upstreamRoot(): string {
	let dir = path.dirname(fileURLToPath(import.meta.url));
	for (;;) {
		const pj = path.join(dir, "node_modules", NAME, "package.json");
		if (fs.existsSync(pj) && JSON.parse(fs.readFileSync(pj, "utf8")).name === NAME) return path.dirname(pj);
		const up = path.dirname(dir);
		if (up === dir) throw new Error(`cannot locate ${NAME}`);
		dir = up;
	}
}

export const root = upstreamRoot();
export const upstreamUrl = (rel: string) => pathToFileURL(path.join(root, rel)).href;
export const upstreamRequire = createRequire(path.join(root, "package.json"));

export interface Tokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface Tests {
	state: "none" | "pass" | "fail" | "stale";
	passed?: number;
	failed?: number;
}

/** Upstream's Band minus the Claude-only `transcript`/`details` fields (metrics only reads these). */
export interface BandData {
	level: string;
	model: string;
	cost: number;
	spent: number;
	turns: number;
	turnCosts: number[];
	tokens: Tokens;
	busyMs: number;
	name: string;
	project: string;
	session: string;
	reused: string[];
	created: string[];
	removed: string[];
	openCallers: string[];
	tests: Tests;
}

export interface Snapshot {
	key: string;
	started: string;
	project: string;
	name: string;
	session: string;
	level: string;
	model: string;
	cost: number;
	lastTurn: number | null;
	turns: number;
	agentMs: number;
	tokens: Tokens;
	reuse: number | null;
	reused: number;
	created: number;
	callersOpen: number;
	tests: string;
}

export interface Metrics {
	CSV_HEADER: string;
	GREP_DEFS: string;
	hits(stdout: string): { file: string; line: string; text: string }[];
	NO_TOKENS: Tokens;
	addedLines(before: string, after: string): string;
	callsIn(text: string, known: Map<string, string>, own: string[]): string[];
	defsIn(file: string, text: string): string[];
	elapsed(ms: number): string;
	fmtTokens(n: number): string;
	inProject(file: string, root: string): boolean;
	isCode(file: string): boolean;
	isSource(file: string): boolean;
	isTestCommand(command: string): boolean;
	markdown(s: Snapshot): string;
	parseDefs(stdout: string): Map<string, string>;
	percent(reused: number, created: number): number | undefined;
	resume(b: BandData, csv: string, key: string): BandData;
	snapshot(b: BandData, startedAt: number): Snapshot;
	taskKey(session: string, startedAt: number): string;
	testCounts(output: string): { passed?: number; failed?: number };
	testsLabel(t: Tests): string;
	totalTokens(t: Tokens): number;
	upsertCsv(existing: string, s: Snapshot): string;
	webhookRequest(
		url: string,
		token: string,
		sendNames: boolean,
		row: Snapshot,
	): { url: string; init: RequestInit } | { refused: string };
}

export interface UpstreamExtension {
	default(pi: unknown): void;
	resolveSessionMode(entries: SessionEntryLike[], fallback?: string): string;
	readDefaultMode(): string;
}

export interface UpstreamConfig {
	getConfigPath(): string;
	getConfigDir(): string;
	getDefaultMode(): string;
}

// Dynamic by necessity: the specifier is a runtime file URL under the resolved package root, because
// upstream's exports map exposes neither pi-extension/ nor hooks/ to a static import.
export const upstream = (await import(upstreamUrl("pi-extension/index.js"))) as UpstreamExtension;
export const metrics = (await import(upstreamUrl("hooks/band/metrics.ts"))) as Metrics;
export const config = upstreamRequire("./hooks/ponytail-config.js") as UpstreamConfig;
export const instructions = upstreamRequire("./hooks/ponytail-instructions.js") as {
	getPonytailInstructions(level: string): string;
};
/** Object property (not a binding) so tests can replace `buildMap`. */
export const mapModule = upstreamRequire("./hooks/ponytail-map.js") as { buildMap(root: string): string };

/** The session's current Level: last persisted `ponytail-mode` entry, else the configured default. */
export function currentLevel(ctx: Ctx): Level {
	return upstream.resolveSessionMode(ctx.sessionManager.getBranch(), upstream.readDefaultMode()) as Level;
}
