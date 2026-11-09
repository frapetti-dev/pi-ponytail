import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { root } from "../src/upstream";

const list = (dir: string): string[] =>
	fs.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) => path.relative(dir, path.join(e.parentPath, e.name)).replace(/\\/g, "/"))
		.sort();

test("skills/ is an exact copy of the pinned upstream skills (run `bun run sync-skills`)", () => {
	const upstreamDir = path.join(root, "skills");
	const ours = path.join(import.meta.dir, "..", "skills");
	const files = list(upstreamDir);
	expect(list(ours)).toEqual(files);
	for (const f of files) {
		expect(fs.readFileSync(path.join(ours, f)).equals(fs.readFileSync(path.join(upstreamDir, f)))).toBe(true);
	}
});
