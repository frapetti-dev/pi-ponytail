import fs from "node:fs";
import path from "node:path";

// Marketplace/git installs don't run `bun install`, so the pinned upstream is committed under vendor/.
const from = path.join(import.meta.dir, "..", "node_modules", "@dietrichgebert", "ponytail");
const to = path.join(import.meta.dir, "..", "vendor", "ponytail");

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`vendored ${from} -> ${to}`);
