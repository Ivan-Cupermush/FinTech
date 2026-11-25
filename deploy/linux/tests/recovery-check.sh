#!/usr/bin/env bash
# Synthetic smoke test: no real systemd service or production data is used.
set -euo pipefail
umask 077
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project=$(cd "$here/../../.." && pwd)
[[ -n "${PGLITE_MODULE:-}" && -f "$PGLITE_MODULE" ]] || { echo 'Set PGLITE_MODULE to the installed PGlite entry point' >&2; exit 1; }
[[ -x "$project/node_modules/.bin/tsx" ]] || { echo 'Install project dependencies first (npm ci)' >&2; exit 1; }
command -v restic >/dev/null
command -v openssl >/dev/null
work=$(mktemp -d "${TMPDIR:-/tmp}/offix-recovery-check.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
mkdir -p "$work/bin" "$work/data/uploads" "$work/restore"
cat > "$work/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
case "$3" in
  --property=LoadState) echo loaded ;;
  --property=ActiveState) echo "${TEST_ACTIVE_STATE:-inactive}" ;;
  --property=SubState) echo "${TEST_SUB_STATE:-dead}" ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$work/bin/systemctl"
export PATH="$work/bin:$PATH"
export RESTIC_REPOSITORY="$work/repository"
export RESTIC_PASSWORD_FILE="$work/password"
openssl rand -hex 32 > "$RESTIC_PASSWORD_FILE"
restic init >/dev/null
node "$here/recovery-fixture.mjs" create "$work/data"

printf 'incorrect-password\n' > "$work/wrong-password"
if RESTIC_PASSWORD_FILE="$work/wrong-password" restic snapshots >/dev/null 2>&1; then
  echo 'A wrong repository password was accepted' >&2; exit 1
fi
if TEST_ACTIVE_STATE=active bash "$here/../backup-pglite.sh" synthetic.service "$work/data" >/dev/null 2>&1; then
  echo 'An active service was accepted' >&2; exit 1
fi
ln -s files "$work/data/uploads/link"
if bash "$here/../backup-pglite.sh" synthetic.service "$work/data" >/dev/null 2>&1; then
  echo 'A symlink was accepted' >&2; exit 1
fi
rm "$work/data/uploads/link"
if RESTIC_REPOSITORY="$work/data/inside" bash "$here/../backup-pglite.sh" synthetic.service "$work/data" >/dev/null 2>&1; then
  echo 'A repository inside the data directory was accepted' >&2; exit 1
fi
started=$SECONDS
bash "$here/../backup-pglite.sh" synthetic.service "$work/data"
restic check --read-data >/dev/null
restic restore latest --tag offix-pglite-offline --target "$work/restore" >/dev/null
node "$here/recovery-fixture.mjs" verify "$work/restore$work/data"
printf 'Backup, full repository check and isolated restore completed in %s seconds.\n' "$((SECONDS - started))"

# Actual app API, still entirely synthetic and offline. Its two node processes
# close PGlite and the file store before backup and after validation.
mkdir -p "$work/app-data" "$work/app-restore"
export RESTIC_REPOSITORY="$work/app-repository"
restic init >/dev/null
"$project/node_modules/.bin/tsx" "$project/server/test/recovery.fixture.ts" create "$work/app-data"
started=$SECONDS
bash "$here/../backup-pglite.sh" synthetic.service "$work/app-data"
restic check --read-data >/dev/null
restic restore latest --tag offix-pglite-offline --target "$work/app-restore" >/dev/null
"$project/node_modules/.bin/tsx" "$project/server/test/recovery.fixture.ts" verify "$work/app-restore$work/app-data"
printf 'App snapshot, repository check, restore and verification: %s seconds.\n' "$((SECONDS - started))"
