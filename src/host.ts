import fs from "node:fs/promises";
import { readLedger, writeLedger } from "./ledger";
import type { Host } from "./task";
import type { Pi } from "./types";
import { createWebhook } from "./webhook";

/** The real Host: omp's `pi.exec`, the filesystem, the CSV ledger and the webhook. */
export function createHost(pi: Pi): Host {
	return {
		async exec(cmd, args, cwd) {
			try {
				const r = await pi.exec(cmd, args, { cwd });
				return { stdout: r.stdout, code: r.code };
			} catch {
				return { stdout: "", code: -1 };
			}
		},
		readFile: (file) => fs.readFile(file, "utf8").catch(() => undefined),
		now: () => Date.now(),
		readLedger,
		writeLedger,
		sendWebhook: createWebhook(),
	};
}
