import { BandWidget } from "../src/band";
import { BandController } from "../src/commands";
import { composeUpstream } from "../src/compose";
import { createHost } from "../src/host";
import { registerMap } from "../src/map";
import { openPanel } from "../src/panel";
import { forgetLevel, recordLevel, registerSubagentInjection, setLastMainLevel } from "../src/subagent";
import {
	type AgentEndEvent,
	type InputEvent,
	type MessageEndEvent,
	TaskTracker,
	type ToolCallEvent,
	type ToolResultEvent,
} from "../src/task";
import { type Ctx, isMain, type Level, type Pi } from "../src/types";
import { config, currentLevel } from "../src/upstream";

export default function ponytail(pi: Pi) {
	// Handlers below act for the main session only: omp re-runs this factory for every subagent session.
	let controller: BandController | undefined;
	const widget: BandWidget = new BandWidget({
		band: () => tracker.current?.band,
		level: () => lastLevel,
		run: (act) => controller?.run(act),
	});
	const tracker = new TaskTracker(createHost(pi), () => widget.refresh());
	let lastLevel: Level = "full";

	const showPanel = (ctx: Ctx) =>
		openPanel(ctx, { level: () => lastLevel, defaultLevel: () => config.getDefaultMode(), setLevel: core.setLevel, setDefault: core.setDefault });
	const core = composeUpstream(pi, {
		onLevelChange(level) {
			lastLevel = level;
			tracker.setLevel(level);
			setLastMainLevel(level);
			widget.refresh();
		},
		openPanel: showPanel,
	});
	controller = new BandController(pi, { setLevel: core.setLevel, openPanel: showPanel }, tracker, widget);
	controller.register();
	registerSubagentInjection(pi);
	registerMap(pi);

	const main = (ctx: Ctx): boolean => {
		if (!isMain(ctx)) return false;
		if (controller) controller.ctx = ctx;
		return true;
	};

	for (const event of ["session_start", "session_switch", "session_branch"]) {
		pi.on(event, async (_e: unknown, ctx) => {
			if (!main(ctx)) return;
			lastLevel = currentLevel(ctx);
			recordLevel(ctx, lastLevel);
			await tracker.startTask(ctx);
			controller?.attach(ctx);
		});
	}
	pi.on("session_tree", (_e: unknown, ctx) => {
		if (main(ctx)) recordLevel(ctx);
	});
	pi.on("session_shutdown", (_e: unknown, ctx) => {
		if (!main(ctx)) return;
		controller?.detach(ctx);
		forgetLevel(ctx);
	});
	pi.on("before_agent_start", async (_e: unknown, ctx) => {
		if (!main(ctx)) return;
		lastLevel = currentLevel(ctx);
		recordLevel(ctx, lastLevel);
		await tracker.beforeAgentStart(ctx);
	});
	pi.on("input", (e: InputEvent, ctx) => {
		if (main(ctx)) tracker.input(e);
	});
	pi.on("agent_start", (_e: unknown, ctx) => {
		if (main(ctx)) tracker.agentStart(ctx);
	});
	pi.on("message_end", (e: MessageEndEvent, ctx) => {
		if (main(ctx)) tracker.messageEnd(e);
	});
	pi.on("tool_call", async (e: ToolCallEvent, ctx) => {
		if (main(ctx)) await tracker.toolCall(e, ctx);
	});
	pi.on("tool_result", (e: ToolResultEvent, ctx) => {
		if (main(ctx)) tracker.toolResult(e, ctx);
	});
	pi.on("agent_end", async (e: AgentEndEvent, ctx) => {
		if (main(ctx)) await tracker.agentEnd(e, ctx);
	});
}
