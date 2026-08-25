#!/usr/bin/env bash
# Regenerate the @girs type stubs that `npm run typecheck` needs.
#
# Two passes, because neither tool does the whole job:
#
#   1. `ags types` for the core -- GLib, Gio, GTK, Astal itself. It runs
#      ts-for-gir with data directories baked into its own binary, which is why
#      it cannot be pointed at anything else.
#   2. ts-for-gir directly for the rest: the Astal service libraries, libadwaita
#      and NetworkManager, whose GIR XML lives in Nix store paths that the dev
#      shell puts in MANIFOLD_GIR_PATH.
#
# The second pass overwrites the `gi.d.ts` aggregator the first one wrote, which
# is why tsconfig includes `@girs/*.d.ts` rather than relying on it.
#
# Run inside `nix develop`. The output is gitignored: it is 20-odd megabytes of
# generated declarations, and it is reproducible from this script.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ -z "${MANIFOLD_GIR_PATH:-}" ]; then
  echo "MANIFOLD_GIR_PATH is unset -- run this inside 'nix develop'." >&2
  exit 1
fi

echo "==> core types, through ags"
ags types '*' -d .

# `share` entries from the dev shell, turned into the gir-1.0 directories
# ts-for-gir wants.
gir_dirs=()
IFS=':' read -r -a shares <<< "$MANIFOLD_GIR_PATH"
for share in "${shares[@]}"; do
  [ -d "$share/gir-1.0" ] && gir_dirs+=("$share/gir-1.0")
done

echo "==> service libraries, through ts-for-gir (${#gir_dirs[@]} gir directories)"
npx --yes @ts-for-gir/cli generate \
  'AstalNotifd-*' 'AstalApps-*' 'AstalMpris-*' 'AstalWp-*' 'AstalNetwork-*' \
  'AstalTray-*' 'AstalBluetooth-*' 'AstalPowerProfiles-*' 'AstalBrightness-*' \
  'AstalBattery-*' 'Adw-*' 'NM-*' \
  -g "${gir_dirs[@]}" -o @girs --ignoreVersionConflicts

printf '==> %s stub files in @girs\n' "$(find @girs -name '*.d.ts' | wc -l)"
