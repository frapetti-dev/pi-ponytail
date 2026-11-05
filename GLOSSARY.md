# pi-ponytail

An omp plugin that brings ponytail, the "lazy senior dev" ruleset and its live task band, to omp, with ANSI and native Tern UI.

## Language

**Ruleset**:
The ponytail prompt text injected into the agent's system prompt, filtered by the current Level.
_Avoid_: skill text, instructions

**Level**:
How hard the Ruleset pushes: off, lite, full (default) or ultra.
_Avoid_: mode, intensity

**Band**:
The strip above the prompt showing the current Task's cost, tokens, agent time, reuse, tests and actions.
_Avoid_: bar, footer, status line

**Task**:
The unit of work the Band measures and the Ledger records as one row.
_Avoid_: job, run

**Ledger**:
The per-project CSV of Tasks, shared with ponytail on other hosts.
_Avoid_: log, history

**Reuse**:
The share of definitions an agent's edits called from existing code versus newly created ones.
_Avoid_: DRY score
