import fs from "node:fs";
import path from "node:path";
import { root } from "../src/upstream";

const from = path.join(root, "skills");
const to = path.join(import.meta.dir, "..", "skills");

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`synced skills from ${from}`);
