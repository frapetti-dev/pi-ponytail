# Duplicate install behaviour

Type: grilling
Status: open
Blocked by: none

## Question

Research 01 showed that when upstream's own pi extension is installed next to pi-ponytail, commands are last-loaded-wins with no warning, both `before_agent_start` handlers run (the Ruleset is injected twice) and the two copies' Levels can diverge. See `research/compose-upstream-extension.md`. What does pi-ponytail do about it? Settle:
- detect and warn, detect and refuse to inject, or document only
- how detection works (command or handler registered by another extension, a marker in the system prompt)
- what the README tells users who already have upstream installed
