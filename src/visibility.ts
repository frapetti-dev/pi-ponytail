import fs from "node:fs";
import path from "node:path";
import { config } from "./upstream";

/** `bandHidden` lives in upstream's config.json next to the default Level; other keys are preserved. */
export function readBandHidden(): boolean {
	try {
		return JSON.parse(fs.readFileSync(config.getConfigPath(), "utf8")).bandHidden === true;
	} catch {
		return false;
	}
}

export type WriteResult = { ok: true } | { ok: false; error: string };

export function writeBandHidden(hidden: boolean): WriteResult {
	const file = config.getConfigPath();
	let stored: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
		else return { ok: false, error: "config.json is not a JSON object; not changed" };
	} catch (e) {
		if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) {
			return { ok: false, error: "config.json is not valid JSON; not changed" };
		}
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify({ ...stored, bandHidden: hidden }, null, 2)}\n`);
	return { ok: true };
}
