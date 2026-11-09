import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { metrics, type Snapshot } from "./upstream";

/** Same location as the Claude Code ponytail band, so one CSV per project serves both hosts. */
export function ledgerDir(): string {
	return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "ponytail", "band");
}

export function ledgerFile(project: string): string {
	return path.join(ledgerDir(), `${project.replace(/[^\w.-]/g, "_")}.csv`);
}

/** The project's ledger text, or "" when it does not exist yet. */
export async function readLedger(project: string): Promise<string> {
	try {
		return await fs.readFile(ledgerFile(project), "utf8");
	} catch (e) {
		if (e instanceof Error && "code" in e && e.code === "ENOENT") return "";
		throw e;
	}
}

/** Replace (or add) the Task's row; one row per Task, rewritten every turn. */
export async function writeLedger(row: Snapshot): Promise<void> {
	await fs.mkdir(ledgerDir(), { recursive: true });
	await fs.writeFile(ledgerFile(row.project), metrics.upsertCsv(await readLedger(row.project), row));
}
