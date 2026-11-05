# Packaging and install

Type: grilling
Status: open
Blocked by: 01, 05

## Question

How is pi-ponytail packaged? Settle:
- `package.json` `name` (it must equal the repo name `pi-ponytail` so omp's installer finds `node_modules/pi-ponytail/package.json`)
- the `omp` manifest: `extensions`, `settings`, and `features` (e.g. Band and map as toggleable features via `omp plugin features`)
- TS vs JS sources
- the dependency range for `@dietrichgebert/ponytail`
- how upstream's skills are exposed to omp's plugin discovery, which scans `skills/` only under the plugin's own root
- the exact install and uninstall commands for the README
