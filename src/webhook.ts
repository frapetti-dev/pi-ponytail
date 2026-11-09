import { createRequire } from "node:module";
import type { Ctx } from "./types";
import { metrics, type Snapshot } from "./upstream";

const STATUS = "ponytail-band";

export interface WebhookConfig {
	url: string;
	token: string;
	sendNames: boolean;
}

export type SettingsLoader = (cwd: string) => Promise<Record<string, unknown>>;

const pluginName = (createRequire(import.meta.url)("../package.json") as { name: string }).name;

/** Plugin settings as `omp plugin config set` stores them; the deep import may not exist on every omp build. */
export const loadPluginSettings: SettingsLoader = async (cwd) => {
	// Dynamic by necessity: a host-internal module that a compiled omp may not bundle; failure disables the webhook.
	const { getPluginSettings } = await import("@oh-my-pi/pi-coding-agent/extensibility/plugins/loader");
	return getPluginSettings(pluginName, cwd);
};

/** Read on every send, so `omp plugin config set` takes effect on the next turn. */
export function toWebhookConfig(stored: Record<string, unknown>): WebhookConfig {
	return {
		url: String(stored.webhookUrl ?? "").trim(),
		token: String(stored.webhookToken ?? process.env.PONYTAIL_WEBHOOK_TOKEN ?? "").trim(),
		sendNames: stored.sendNames !== false,
	};
}

/** Per-session webhook sender (state: the one-time "settings unavailable" warning). */
export function createWebhook(load: SettingsLoader = loadPluginSettings) {
	let warned = false;
	return async function send(row: Snapshot, ctx: Ctx): Promise<void> {
		let stored: Record<string, unknown> = {};
		try {
			stored = await load(ctx.cwd);
		} catch {
			if (!warned) {
				warned = true;
				ctx.ui.notify("ponytail band: plugin settings unavailable; webhook disabled", "warning");
			}
		}
		const { url, token, sendNames } = toWebhookConfig(stored);
		if (url === "") return;
		const req = metrics.webhookRequest(url, token, sendNames, row);
		if ("refused" in req) {
			ctx.ui.setStatus(STATUS, `ponytail band: ${req.refused}`);
			return;
		}
		// Not awaited: a slow endpoint must never hold up the turn.
		fetch(req.url, req.init)
			.then((r) => ctx.ui.setStatus(STATUS, r.ok ? undefined : `ponytail band: webhook answered ${r.status}`))
			.catch(() => ctx.ui.setStatus(STATUS, "ponytail band: webhook unreachable"));
	};
}
