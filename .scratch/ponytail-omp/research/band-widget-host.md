# Research: aboveEditor widget host (omp 18.13.2 + Tern) for the Band

Ticket: `../issues/04-band-widget-host.md`. Sources: omp source under `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/` (`pi-coding-agent` 18.13.2 = `PCA`, `pi-tui` = `TUI`), the `tern-ui` skill (`C:/Users/f.rapetti/.agents/skills/tern-ui/`). Nothing was run inside omp or Tern; the harness proof below fakes the host (see "Proof" for exactly what it shows and what source reading covers). Paths are relative to `src/` of each package.

## Short answers

| Question | Answer |
|---|---|
| `handleNativeEvent` from `omp.btn` clicks? | **Yes.** A widget is a child component of omp's `hookWidgetContainerAbove`, which sits in the composer's native dock. The backend routes `action` events by wire id to the owning component and calls its `handleNativeEvent`. omp's own `HudPillsRow` (same dock) relies on this. |
| `handleInput`? | **Effectively never.** Keys go only to the focused component, which is the editor; a widget is never focused (and `focus` pointer events only focus components that own an `editor`/`input` node). Keyboard access must come from commands (decision 11). |
| `requestRender` from outside the factory? | Capture the `tui` argument the factory receives (it is the real `TUI`, `ctx.ui` of the interactive context) in module state and call `tui.requestRender()` from any event handler; bump a version so a memoized `describe()` returns a new node. |
| Remove | `ctx.ui.setWidget(key, undefined)`; it also runs the old widget's `dispose()`. `hasUI === false` -> `setWidget` is a no-op (print/ACP/no-op ctx) or ignores factories (RPC). |
| `render(width)` width | The terminal's full column count (no padding, no gutter). Over-wide rows are truncated by the TUI. Tern path: `cx.cols` in `describe(cx)`. |
| Clipboard | Not on `pi.pi` (root barrel has no clipboard). Reachable two ways: root import `import { copyToClipboard } from "@oh-my-pi/pi-coding-agent"` (resolves to the legacy shim, which re-exports it) or deep import `@oh-my-pi/pi-coding-agent/utils/clipboard` (`./utils/*` export). `pi.exec` fallback exists but has no stdin; see below. |

## 1. Widget hosting and event routing

- API: `setWidget(key, content, options?)`, `content: string[] | ((tui, theme) => Component & {dispose?}) | undefined`, `options.placement: "aboveEditor" | "belowEditor"` (`PCA extensibility/extensions/types.ts:250-252,361`; `pi-tui chat/extension-types.ts:5-9`; `WidgetPlacement` in `rpc-types.ts:836`). Default placement is `aboveEditor` (`modes/controllers/extension-ui-controller.ts:379`).
- Implementation (`extension-ui-controller.ts:378-443`): `setHookWidget` removes (and `dispose()`s) any existing widget with the same key in both maps, returns if `content === undefined`, otherwise creates the widget (`content(this.ctx.ui, theme)` for a factory, `:413`) and rebuilds the containers. `#rebuildHookWidgets` clears `hookWidgetContainerAbove`, adds a `Spacer(1)` then each widget in key insertion order (`:437-441`), and calls `ctx.ui.requestRender()` (`:419`). String arrays are capped at `MAX_WIDGET_LINES = 10` (`:51,402`); factory components have no cap.
- Layout (`modes/interactive-mode.ts:2141-2143,2424-2496`): `hookWidgetContainerAbove` sits after `statusContainer`/`attachmentChipsContainer` and directly above `editorContainer`; it is listed in both the ANSI roots and the Tern `nativeDock` (`:2480-2494`). So the Band renders between the working/status row and the prompt in both paths.
- Native description: a widget is a child of a plain `Container` whose `describe()` is `col(children)` (`pi-tui tui.ts:637-646`). The reconciler gives every component child its own wire id (`native/reconcile.ts:449-463`); `describe()` is called on the component, and `null` falls back to `render()` rows (`reconcile.ts:930-949`).
- Click path: Tern sends `action`; `native/backend.ts:883-933` (`#routeUiEvent`) looks up `reconciler.target(event.id)`, requires `target.component.handleNativeEvent`, builds `{type:"action", key: target.keypath, act, value, mods}` and calls it, then `host.requestRender()`. The root node's keypath is `""` (`reconcile.ts:956-957`), so for a widget root keyed `band` containing `actions` > `level` the event key is `actions/level` (use `leafKey`). Built-in actions `toggle copy open zoom select activate` are handled by Tern and not delivered (`omp-extension.md:54`); use other names (`level`, `fold`, `copy-md`, ...).
- Same-dock precedent: `HudPillsRow` (`interactive-mode.ts:722-739`) is a dock component with `describe()` + `handleNativeEvent` that opens the agent hub on an `action`. It is not a hook widget, but it proves the dock delivers clicks to ordinary `Component`s.
- [INFERENCE] A live Tern click on a hook widget was not run (no Tern session available to the agent); source routing plus the `HudPillsRow` precedent is the evidence.

## 2. handleInput

- Keyboard goes through `TUI.#handleInput` (`pi-tui tui.ts:2924-3050`): input listeners first (`addInputListener`, exposed to extensions as `ctx.ui.onTerminalInput`, `extension-ui-controller.ts:161,1374-1381`), then `#inputTarget()` = the focused component if it has `handleInput`, else the key-holding overlay's pre-focus (`tui.ts:3056-3061`). The editor is focused (`interactive-mode.ts:2497 this.ui.setFocus(this.editor)`), and a visible overlay takes focus on mount (`tui.ts:1309-1314`).
- A widget gets focus only if someone calls `tui.setFocus(widget)` (`tui.ts:1247`; the factory's `tui` is the real TUI, so it is technically possible but steals the prompt) or via a pointer `focus` event, which only focuses a component that owns an `editor`/`input` node (`backend.ts:870-879`, `reconcile.ts:375-378`). A Band has neither. Conclusion: implement `handleInput` only as a harmless no-op/twin if desired; do not rely on it. Keyboard twins = commands (`/ponytail-band ...`). `ctx.ui.onTerminalInput` is a global alternative but is out of scope (decision 11: no global shortcuts) and `ctrl+c/d/z/k/p/l/o/t/g/q`, `alt+m`, `shift+tab` are reserved anyway (`omp-extension.md:122`).

## 3. requestRender from outside the factory

- The factory receives `(tui, theme)`; `tui` is `this.ctx.ui` of the interactive context, typed `TUI` (`modes/types.ts:153`, `extension-ui-controller.ts:413`). `TUI.requestRender(force=false)` is public (`tui.ts:2762`) and `requestComponentRender(component)` just schedules an ordinary render (`tui.ts:2806-2808`).
- Pattern (proved in the harness): module-level `let liveTui`; the factory sets `liveTui = tui` and `dispose()` clears it; a `turn_end` (etc.) handler mutates module state, bumps `version`, calls `liveTui?.requestRender()`. `describe()` must return a new node when `version` changes and the same node otherwise (`Memo`).
- The widget is rebuilt (factory re-run) whenever `setWidget(key, factory)` is called again with a new factory; avoid that for updates, just re-render.
- Lifecycle caveats: widgets are cleared (and disposed) by `clearHookWidgets` at `interactive-mode.ts:7689` (shutdown) and on the extension-command-context `newSession`/`switchSession` paths (`extension-ui-controller.ts:273-275,335-336,505-507,565-566`). The built-in `/new` (`command-controller.ts:1344`), `/resume` (`selector-controller.ts:1991`), `/fork`/`branch`/`tree` paths do not call it (grep of `clearHookWidgets` shows only those call sites), so the widget normally survives them; re-assert it on `session_start`/`session_switch` anyway (the module-level `liveTui` must tolerate `dispose()` having run).

## 4. Removal and `hasUI === false`

- Removal: `setWidget(key, undefined)` -> `#removeHookWidget` calls `dispose()` and deletes the entry, then rebuilds (`extension-ui-controller.ts:380-386,393-397`). Calling `setWidget` with an existing key replaces and disposes the old one (`:380-381`). `clearHookWidgets` disposes all on shutdown (`:1383-1393`).
- `ctx.hasUI` is `runner.hasUI()` = "UI context is not the no-op context" (`extensibility/extensions/runner.ts:1027-1029`), copied into each `ExtensionContext` (`runner.ts:1490`; type `types.ts:691-692`).
- With no UI: the no-op context's `setWidget` is `() => {}` (`runner.ts:469`), the factory is never called (so no timers are created); ACP: `acp/acp-agent.ts:755` no-op; `session/agent-session.ts:687` no-op; RPC mode: factories are ignored, only `string[]`/`undefined` is forwarded as an `extension_ui_request` (`modes/rpc/rpc-mode.ts:1595-1608`). So the extension must not require a widget, must guard state (`liveTui?.`), and should skip `ctx.ui.notify`-style confirmation reliance; ledger/webhook logic must never live inside the widget factory.
- Native vs ANSI: `tui.nativeRendering` (`tui.ts:1686`) tells from inside the factory whether a TSP surface is live; `describe()` is only called then. Both `describe` and `render` are required (`SKILL.md` section 3; `tui.ts:265-273`).

## 5. render(width) width

- ANSI: `Composer.renderFrame` sets `width = max(1, viewport.columns)` (`pi-tui prompt/composer.ts:393`) and each root (incl. `hookWidgetContainerAbove`) is `root.render(width)` (`composer.ts:408,415,579`); `Container.render` passes it unchanged to children (`tui.ts:608-635`). So the widget gets the **full terminal column count**, no gutter. A string array widget would be wrapped in `Text(line, 1, 0)` (1 col padding, `extension-ui-controller.ts:403`); a component is not padded.
- Rows wider than the width are truncated with `truncateToWidth` (`tui.ts:4151-4152`), but a widget should do its own `fit` so styling/ellipsis are controlled (the template's `fit` in `nodes.ts`). Rows must contain no `\n`.
- Native: `describe(cx)` gets `cx.cols` (pane columns, `native/node.ts` `DescribeContext`; the fallback `rows` node uses `cols`, `reconcile.ts:948`). Include `cx.cols` in the `Memo` deps if the layout depends on it (compact vs detail breakpoints). Proof: the harness `--cols 37` run showed `"text": "lvl full · 1 turns · compact · w37"` and `render(37)` truncated with an ellipsis (`... [render…`).

## 6. Clipboard

Facts:
- `copyToClipboard(text): Promise<void>` is in `utils/clipboard.ts:129-187`. It writes OSC 52 first when `process.stdout.isTTY` (works over SSH), then tries Termux, macOS `pbcopy`, then the native addon `@oh-my-pi/pi-natives/clipboard`. All errors are swallowed ("best-effort", `:182-184`): it never rejects and gives **no success signal**.
- Root barrel: `src/index.ts` has no clipboard export (only `export * from "./utils/github"` at `:76`; grep of `index.ts`/`tools/index.ts` finds none). `pi.pi` is `typeof PiCodingAgent` = `import * as PiCodingAgent from "../../index"` (`extensibility/extensions/loader.ts:29,192,452`), so `pi.pi.copyToClipboard` does **not** exist.
- `package.json` `exports` has `"./*": { import: "./src/*.ts" }` and `"./utils/*": { import: "./src/utils/*.ts" }`, so the deep specifier `@oh-my-pi/pi-coding-agent/utils/clipboard` is a legal subpath (`pi-coding-agent/package.json`, `exports`).
- Runtime resolution for extensions: `@oh-my-pi/pi-coding-agent[/...]` (and legacy scopes `@mariozechner`, `@earendil-works`, `@oh-my-pi`) matches `LEGACY_PI_SPECIFIER_FILTER` (`extensibility/plugins/legacy-pi-compat.ts:808-857`) and is resolved against the host copy, not a plugin-local copy (`:804-813`). The package **root** is redirected to the legacy shim (`:975-984,993-995`), and the shim re-exports it: `export { copyToClipboard } from "../utils/clipboard"` (`extensibility/legacy-pi-coding-agent-shim.ts:1648`; type in `dist/types/extensibility/legacy-pi-coding-agent-shim.d.ts:455`). In compiled binaries (`USE_BUNDLED_PI_MODULES`, `legacy-pi-compat.ts:21`) only the root virtual module is guaranteed, so the root import is the safer spelling.

**Recommended route (pi-ponytail):** `import { copyToClipboard } from "@oh-my-pi/pi-coding-agent";` (value import, host-provided, do not add a dependency), wrapped in try/catch, then `ctx.ui.notify("Band copied as Markdown", "info")`. Because it never rejects, notify "Copied" is optimistic; omp's own callers do the same (`interactive-mode.ts:2521-2524` shows "Copied to clipboard" after `.then`). The deep specifier `@oh-my-pi/pi-coding-agent/utils/clipboard` is an equivalent second route. Neither was imported live in omp (no clipboard overwrite was done); resolution is from source.

**Fallback if the import fails** (`pi.exec` facts): `pi.exec(command, args, {signal?, timeout?, cwd?})` -> `{stdout, stderr, code, killed}` (`extensions/types.ts:1955`; `exec/exec.ts:9-16,40-55`). It has **no stdin and no env option**, so text can only go through argv, a temp file, or Bun's own spawn. I tested PowerShell 7.6.9 here (observed):
- `powershell -NoProfile -Command 'Write-Output ($args.Count)' "hello world"` printed `args=0` (trailing argv after `-Command` are NOT `$args`) and a trailing quoted string is re-parsed as commands. Do **not** pass the Markdown as an argv after `-Command` (command injection + wrong result).
- Safe form, observed working with `Bun.spawn` and stdin (exit 0, 47-char Unicode/quote/backtick/`$()` payload round-tripped intact): `Bun.spawn(["powershell","-NoProfile","-NonInteractive","-Command","[Console]::InputEncoding=[Text.Encoding]::UTF8; $t=[Console]::In.ReadToEnd(); Set-Clipboard -Value $t"], {stdin: new Blob([text])})`. (The test printed the text instead of calling `Set-Clipboard`, to avoid overwriting the user's clipboard; `Set-Clipboard` is the real call.)
- `pi.exec`-only variant per OS, writing the text to a temp file first (`os.tmpdir()`, mode 0600, delete after), text never on the command line:
  - win32: `["powershell","-NoProfile","-NonInteractive","-Command", "Get-Content -Raw -Encoding UTF8 -LiteralPath '<tmp>' | Set-Clipboard"]` (single quotes in `<tmp>` doubled). Avoid `clip.exe` (OEM code page mangles non-ASCII).
  - darwin: `["sh","-c","LANG=en_US.UTF-8 pbcopy < \"$1\"","sh","<tmp>"]`.
  - linux: `["sh","-c","if [ -n \"$WAYLAND_DISPLAY\" ] && command -v wl-copy >/dev/null; then wl-copy < \"$1\"; elif command -v xclip >/dev/null; then xclip -selection clipboard < \"$1\"; elif command -v xsel >/dev/null; then xsel --clipboard --input < \"$1\"; else exit 1; fi","sh","<tmp>"]`; Termux: `termux-clipboard-set` (`clipboard.ts:144-151`).
  - Over SSH these hit the remote host's clipboard; omp itself relies on OSC 52 there (`clipboard.ts:70-79,129-130`). Do not hand-write OSC 52 from the extension: while a TSP surface is live, non-TSP bytes are hidden (`SKILL.md` section 3).
  The fallback is only needed if the host import path breaks; none of the three shell variants was executed except the stdin test above.
- A `pi.exec` call of a temp-file route is itself not exercised in omp; the harness fake only logs argv.

## Proof (describe-harness)

Throwaway extension at `%TEMP%\ponytail-band-widget-proof\index.ts` (+ copied `nodes.ts`, `ev.json`): command `band` calls `ctx.setWidget("ponytail-band", factory, {placement:"aboveEditor"})` for a one-row Band: a text row plus three `omp.btn` buttons (`level`, `copy`, `fold`), `describe()` memoized on `[version, cx.dark, cx.cols]`, `render(w)` ANSI row, `handleNativeEvent`, a `handleInput("l")` twin, module-level `liveTui` captured from the factory, `dispose()` clearing it, and a timer that mutates state and calls `liveTui.requestRender()` from outside the factory.

Command (from `%TEMP%\ponytail-band-widget-proof`):
`bun C:/Users/f.rapetti/.agents/skills/tern-ui/scripts/describe-harness.ts index.ts --command band --events ev.json --ansi --cols 90`
with `ev.json` = action events with the real key shape `actions/level`, `actions/fold`, `actions/copy`, and `{"input":"l"}`.

Observed (exit 0, output filtered to the relevant lines):
```
setWidget ponytail-band: {"placement":"aboveEditor"}
requestRender() from outside the factory (simulated turn_end); liveTui captured: true
"text": "lvl full · 1 turns · compact · w90"
memo-stable: true
(1 rows)    [render row: "lvl full · 1 turns · compact [render width=90]"]
event 0: {"type":"action","key":"actions/level","act":"level","mods":[]}
handleNativeEvent: {...} -> leafKey=level        => "lvl ultra · 1 turns · compact"
event 1: {"type":"action","key":"actions/fold",...}  -> leafKey=fold     => "... · detail" (button title Details -> Compact)
event 2: {"type":"action","key":"actions/copy",...}  -> leafKey=copy
event 3: input "l"  handleInput: "l"                  => "lvl off · 1 turns · detail"
```
Buttons in the printed tree: `{"k":"row","p":{"role":"omp.btn","actions":{"click":"level"},...},"key":"level"}` (and `copy`, `fold`).

What this proves: the widget's `describe()` builds `omp.btn` rows keyed by act; a `NativeUiEvent` of the shape omp's backend builds (`backend.ts:913-915`) invoked on the component changes state and re-describes; `handleInput` works if called; `memo-stable: true`; `requestRender` is callable from outside the factory through a captured `tui`; `render(width)` honours the width argument. What it does not prove: the harness calls `handleNativeEvent` itself (it fakes the host and fakes `requestRender`/`hasUI`/`supports`), so "Tern/omp deliver the click to the widget" rests on the source citations in section 1, not the harness. The first run used an invented `band/actions/level` key and a placeholder `pi.exec` powershell argv; both were corrected (key path -> `actions/level` per `reconcile.ts:956-957`; the exec line removed, see section 6) and the run above is the second run.

## Implications for other tickets

- 07 (band prototype): build the Band as one component with `describe` + `render`, state in module scope, actions `level|fold|copy-md|review|audit` (avoid built-ins `copy`, `toggle`, `open`, `zoom`, `select`, `activate`: `omp-extension.md:54`; the harness used `copy` only because the fake host does not intercept it, **in real Tern an action named `copy` is handled by Tern and never reaches `handleNativeEvent`** -> name it `copy-md`). Review/Audit: the click handler can call `pi.sendUserMessage`/command equivalents.
- 06/07: Band widget height is free (no 10-line cap for factories); the leading `Spacer(1)` and `EditorTopGap` are added by the host (`extension-ui-controller.ts:437`).
- 08: `copyToClipboard` is imported from the host root; no packaging implication beyond not bundling `@oh-my-pi/*`.
