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
for RECOVERY_STORE in fs kusok; do
  export RECOVERY_STORE
  data="$work/app-data-$RECOVERY_STORE"
  target="$work/app-restore-$RECOVERY_STORE"
  mkdir -p "$data" "$target"
  export RESTIC_REPOSITORY="$work/app-repository-$RECOVERY_STORE"
  restic init >/dev/null
  "$project/node_modules/.bin/tsx" "$project/server/test/recovery.fixture.ts" create "$data"
  started=$SECONDS
  bash "$here/../backup-pglite.sh" synthetic.service "$data"
  if [[ "$RECOVERY_STORE" = fs ]]; then
    # This is an ephemeral repository with one synthetic key, never production.
    openssl rand -hex 32 > "$work/rotated-password"
    restic key passwd --new-password-file "$work/rotated-password" >/dev/null
    if restic snapshots >/dev/null 2>&1; then
      echo 'The previous password still opens the rotated test repository' >&2; exit 1
    fi
    export RESTIC_PASSWORD_FILE="$work/rotated-password"
    restic snapshots --tag offix-pglite-offline >/dev/null
  fi
  restic check --read-data >/dev/null
  restic restore latest --tag offix-pglite-offline --target "$target" >/dev/null
  "$project/node_modules/.bin/tsx" "$project/server/test/recovery.fixture.ts" verify "$target$data"
  printf 'App %s snapshot, repository check, restore and verification: %s seconds.\n' "$RECOVERY_STORE" "$((SECONDS - started))"
  if [[ "$RECOVERY_STORE" = fs ]]; then
    # A new repository has a new master key; copy and verify the test snapshot.
    source_repo="$RESTIC_REPOSITORY"
    source_password="$RESTIC_PASSWORD_FILE"
    openssl rand -hex 32 > "$work/fresh-password"
    export RESTIC_REPOSITORY="$work/fresh-repository"
    export RESTIC_PASSWORD_FILE="$work/fresh-password"
    restic init >/dev/null
    restic copy --from-repo "$source_repo" --from-password-file "$source_password" >/dev/null
    if RESTIC_PASSWORD_FILE="$source_password" restic snapshots >/dev/null 2>&1; then
      echo 'The old repository password opened the new repository' >&2; exit 1
    fi
    restic check --read-data >/dev/null
    mkdir -p "$work/fresh-restore"
    restic restore latest --tag offix-pglite-offline --target "$work/fresh-restore" >/dev/null
    "$project/node_modules/.bin/tsx" "$project/server/test/recovery.fixture.ts" verify "$work/fresh-restore$data"
    printf 'Verified copied snapshot in a new encrypted repository.\n'
  fi
done
