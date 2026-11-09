declare module "@oh-my-pi/pi-coding-agent" {
	export function copyToClipboard(text: string): Promise<void>;
}
declare module "@oh-my-pi/pi-coding-agent/extensibility/plugins/loader" {
	export function getPluginSettings(pluginName: string, cwd: string): Promise<Record<string, unknown>>;
}
