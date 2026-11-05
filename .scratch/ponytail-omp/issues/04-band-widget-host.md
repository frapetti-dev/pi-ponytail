# Band widget host

Type: research
Status: resolved
Blocked by: none

## Question

What can an `aboveEditor` widget (`ctx.ui.setWidget(key, factory, {placement:"aboveEditor"})`) do in omp 18.13.2 and Tern?
- Does its component receive `handleNativeEvent` clicks from `omp.btn` rows?
- Can it ever receive `handleInput`?
- How does `requestRender` get called from outside the factory?
- How is the widget removed (`setWidget(key, undefined)`), and what happens when `ctx.hasUI` is false?
- Which width does `render(width)` get?
- How can an extension copy text to the system clipboard? `copyToClipboard` in `src/utils/clipboard.ts` is not root-exported; check the `exports` map, `pi.pi` namespace and the legacy shim, otherwise give a `pi.exec` fallback per OS.

Use the tern-ui skill's `scripts/describe-harness.ts` to prove a button click reaches the widget.

## Answer

- Clicks: yes. A widget is a child of `hookWidgetContainerAbove` in the Tern native dock; `backend.ts#routeUiEvent` calls its `handleNativeEvent({type:"action", key:"actions/<btn>", act})`. Do not name an action `copy` (Tern handles it itself); use `copy-md`, `level`, `fold`.
- `handleInput`: effectively never (editor holds focus; widgets are not focused). Keyboard access = `/ponytail-band` commands.
- `requestRender`: capture the factory's `tui` (real `TUI`) in module state, bump a version, call `tui.requestRender()` from any event handler; clear it in `dispose()`.
- Remove: `setWidget(key, undefined)` (disposes). `hasUI === false`: `setWidget` is a no-op (print/ACP), RPC ignores factories; never put ledger/webhook logic in the factory. `render(width)` = full terminal columns, unpadded (Tern: `cx.cols`).
- Clipboard: not on `pi.pi`; use `import { copyToClipboard } from "@oh-my-pi/pi-coding-agent"` (legacy shim re-export) or deep `.../utils/clipboard`. It never rejects. `pi.exec` has no stdin: fallback is a temp-file route or `Bun.spawn` with stdin; never pass text after `-Command` (observed `args=0` and re-parsed as commands).
- Harness proof run (button actions, `handleInput`, outside `requestRender`, `memo-stable: true`); it fakes the host, so real routing is cited from source. Details: [../research/band-widget-host.md](../research/band-widget-host.md)
