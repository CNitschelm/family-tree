#!/usr/bin/env bash
# cloud-verify.sh — prove that a cloud session has everything the PC had and that the tools work in
# the new layout. Read-only, except the session-local files the checks write (.gate-stamp and the
# rebuilt check outputs, all ignored by the public repo). Pushes nothing.
#
#   bash cloud-verify.sh        (after cloud-setup.sh)
#
# Exit 0 only when every check passes. Never prints a secret. FT_VERIFY_SKIP_TOOLS=1 (rehearsal only)
# skips the secrets and tools sections.

set -uo pipefail
[ -f "$HOME/.ft-env" ] && . "$HOME/.ft-env"
FT="${FT_DIR:?run cloud-setup.sh first}"; PRIV="${FT_PRIVATE_DIR:?run cloud-setup.sh first}"
nfail=0
ok()  { printf 'PASS  %s\n' "$*"; }
bad() { printf 'FAIL  %s\n' "$*"; nfail=$((nfail+1)); }
run() { local what="$1"; shift; if ( cd "$FT" && "$@" ) >/tmp/ft-verify.out 2>&1; then ok "$what"; else bad "$what"; sed 's/^/        /' /tmp/ft-verify.out | tail -25; fi; }
entries() { while IFS= read -r n || [ -n "$n" ]; do n="${n%$'\r'}"; n="${n%/}"; case "$n" in ''|'#'*) continue ;; esac; printf '%s\n' "$n"; done < "$PRIV/.private-paths"; }
priv_before="$(git -C "$PRIV" status --porcelain)"

# 1. every backed-up file arrived, byte for byte
if [ -f "$PRIV/MANIFEST.sha256" ]; then
  ( cd "$PRIV" && sha256sum --quiet -c MANIFEST.sha256 ) >/tmp/ft-verify.out 2>&1 \
    && ok "all $(wc -l < "$PRIV/MANIFEST.sha256" | tr -d ' ') backed-up files match the PC's hashes (MANIFEST.sha256)" \
    || { bad "files differ from MANIFEST.sha256:"; head -20 /tmp/ft-verify.out | sed 's/^/        /'; }
else bad "no MANIFEST.sha256 in family-tree-private"; fi
if [ -f "$PRIV/.backup-info.json" ]; then
  sc=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("site_commit",""))' "$PRIV/.backup-info.json" 2>/dev/null)
  if [ -n "$sc" ] && git -C "$FT" merge-base --is-ancestor "$sc" origin/main 2>/dev/null; then
    ok "the backup was taken at site commit $(printf %.7s "$sc"), which is on origin/main"
  else bad "the backup's site commit '${sc:-?}' is not on origin/main"; fi
fi

# 2. the links, and that the public repo ignores all of them
lbad=0
while IFS= read -r name; do
  if [ -L "$FT/$name" ] && [ -e "$FT/$name" ] && git -C "$FT" check-ignore -q --no-index -- "$name"; then :; else bad "$name: not a working, ignored link"; lbad=1; fi
done < <(entries)
[ $lbad = 0 ] && ok "every private entry ($(entries | wc -l | tr -d ' ')) is a working link and ignored by the public repo"
[ -z "$(git -C "$FT" status --porcelain)" ] && ok "public repo: clean" || bad "public repo is not clean: $(git -C "$FT" status --porcelain | head -3 | tr '\n' ' ')"
[ "$(git -C "$FT" rev-parse --is-shallow-repository)" = false ] && ok "public repo: full history ($(git -C "$FT" rev-list --count HEAD) commits)" || bad "public repo is shallow"
[ "$(git -C "$FT" config core.hooksPath)" = githooks ] && ok "commit hook on" || bad "core.hooksPath is not githooks"
h="$(git -C "$FT" rev-parse HEAD)"; q="$(git -C "$FT" rev-parse -q --verify refs/remotes/queue/site-queue || true)"
if [ "$h" = "$(git -C "$FT" rev-parse origin/main)" ]; then ok "site clone is at public main"
elif [ -n "$q" ] && [ "$h" = "$q" ]; then ok "site clone is at the queue's head ($(git -C "$FT" rev-list --count origin/main..HEAD) commit(s) not yet published)"
else bad "site clone is at neither public main nor the queue's head"; fi

if [ "${FT_VERIFY_SKIP_TOOLS:-0}" != 1 ]; then   # (the rehearsal skips 3 and 4: it has no real data)
# 3. the secrets and the working copy (values never printed)
[ -n "${FT_PASSWORD:-}" ] && ok "FT_PASSWORD is set" || bad "FT_PASSWORD is not set"
[ -n "${FT_OWNER_KEY:-}" ] && ok "FT_OWNER_KEY is set" || printf 'note  FT_OWNER_KEY is not set (only owner links need it)\n'
[ ! -e "$FT/.password" ] && ok "no .password file on disk (the tools read FT_PASSWORD)" || bad ".password exists on disk"
[ -s "$FT/data.json" ] && [ -s "$FT/.data-stamp" ] && ok "data.json decrypted from this index.html (stamped)" || bad "no data.json / .data-stamp"

# 4. the tools, in the new layout
run "tools/doctor.js: no blocker" node tools/doctor.js
run "tools/lock.js status reads ledger/LOCK" node tools/lock.js status
run "research.json validates" node tools/research.js validate
run "media/research*.bin are exactly what research.json makes" node tools/research.js check
run "tests/research.js" node tests/research.js
# tests/ledger.js builds a throwaway repo with its own test password, but the tools it runs read
# FT_PASSWORD first, so the real one must be out of its way (until tests/ledger.js clears it itself).
run "tests/ledger.js" env -u FT_PASSWORD -u FT_OWNER_KEY node tests/ledger.js
run "checks/gate.js passes with no change (payload = data.json, ledger explains origin/main, tests, archive evidence)" node checks/gate.js
fi

# 5. nothing changed by checking
[ -z "$(git -C "$FT" status --porcelain)" ] && ok "public repo still clean after the checks" || bad "the checks changed site files: $(git -C "$FT" status --porcelain | head -3 | tr '\n' ' ')"
[ "$(git -C "$PRIV" status --porcelain)" = "$priv_before" ] && ok "family-tree-private unchanged by the checks" || bad "the checks changed private files: $(git -C "$PRIV" status --porcelain | head -5 | tr '\n' ' ')"

echo; [ $nfail = 0 ] && echo "VERIFY: PASS" || echo "VERIFY: $nfail FAIL"
[ $nfail = 0 ]
