# pi-ponytail

[ponytail](https://github.com/DietrichGebert/ponytail) for [omp](https://github.com/can1357/oh-my-pi). It runs upstream's pi extension unchanged (the Ruleset, `/ponytail`, the status badge) and adds:

- **Band**: a one-line live readout above the editor (cost, tokens, turns, time, reuse, tests) with buttons for Level, Review, Audit, Copy and Details. Native (Tern) and ANSI terminals.
- **Ledger**: one CSV row per Task, rewritten every turn, same file and columns as the Claude Code ponytail band.
- **Webhook**: the same row, POSTed after every turn.
- **Ruleset for subagents**: `task`/`eval` subagents get the Ruleset at the parent's Level.
- **Codebase map**: upstream's map of existing code, appended to the system prompt.

Terms (Level, Band, Task, Ledger, Reuse, Ruleset) are defined in [GLOSSARY.md](GLOSSARY.md).

## Install

```sh
omp plugin install github:frapetti-dev/pi-ponytail
omp plugin uninstall @frapetti-dev/pi-ponytail
```

Develop locally: run `bun install` in the repo, then `omp plugin link <path-to-repo>`.

Do not also install upstream's own omp plugin. A guard skips the second Ruleset injection and warns once, but it only works when the other copy loads first.

## `/ponytail-band`

| Command | Effect |
|---|---|
| `/ponytail-band` | Show state: shown or hidden, compact or detail, Level |
| `on` / `off` | Show or hide the Band; persisted as `bandHidden` in upstream's `config.json` |
| `level [off\|lite\|full\|ultra]` | Switch Level, or open the picker without an argument |
| `review` / `audit` | Send the ponytail-review or ponytail-audit skill as a message |
| `copy` | Copy the Band as Markdown |
| `fold` | Toggle the detail line |

The Level button, Review, Audit, Copy and Details do the same from the Band. With Level `off` the Band shrinks to a dim strip with only the Level button.

## Settings

```sh
omp plugin config set @frapetti-dev/pi-ponytail webhookUrl https://example.com/hook
omp plugin config set @frapetti-dev/pi-ponytail webhookToken <token>
omp plugin config set @frapetti-dev/pi-ponytail sendNames false
```

- `webhookUrl`: https, or http on `localhost`, `127.0.0.1`, `[::1]`. Empty disables. Takes effect on the next turn.
- `webhookToken`: sent as a bearer token. Falls back to `PONYTAIL_WEBHOOK_TOKEN`.
- `sendNames`: set `false` to send an empty Task name.

## Environment

| Variable | Effect |
|---|---|
| `PONYTAIL_MAP=0` | Disable the codebase map |
| `PONYTAIL_SUBAGENT_MATCHER` | Case-insensitive regex on the subagent name; only matching subagents get the Ruleset. Invalid regex injects everywhere |
| `PONYTAIL_WEBHOOK_TOKEN` | Webhook token when the setting is empty |
| `XDG_CONFIG_HOME` | Moves the Ledger and upstream's config |

## Ledger

`<XDG_CONFIG_HOME or ~/.config>/ponytail/band/<project>.csv`. One row per Task, keyed by session and start time. `/clear` starts a new Task; `/resume` continues the old row. Cost is the session's cost since the Task began, per `provider/model` shown in the `model` column.

## Known gap

A revived (kept-alive) subagent gets the Ruleset on its first prompt but not on later turns that arrive without a prompt: omp discards the result of the revive hook.

## Upgrading upstream

Upstream is pinned to an exact version. Its `skills/` are copied into this repo because omp reads plugin skills only from the plugin root.

1. Bump `@dietrichgebert/ponytail` in `package.json` (exact version).
2. `bun install`
3. `bun run sync-skills`
4. `bun test` (a drift test fails if `skills/` differs from upstream's).
