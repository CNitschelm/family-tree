#!/usr/bin/env bash
# cloud-finish.sh — end a cloud session: the evidence and the state first, then the site. Nothing survives
# the machine unless it is pushed, so every session that changed anything ends with this.
#
#   bash cloud-finish.sh "<one neutral line for the private commit>" ["<who holds the writer lock>"]
#   FT_PUBLISH=notes bash cloud-finish.sh "Save research notes"      # the notes checkpoint
#
# The site goes into the QUEUE: family-tree-private's branch site-queue. The airlock (the private
# repo family-tree-airlock, which no session or routine has attached) checks every queued commit and
# publishes it to the public repo's main within about two hours; its verdict is in
# family-tree-private's branch airlock-status. Runs never push to the public repo themselves.
# FT_PUBLISH=direct (interactive sessions only, with Cory there) pushes to public main instead: for
# the changes the airlock does not publish (tools, tests, documents), only while the queue is empty.
# Site commits go out only under the writer lock: <who> must hold it, on GitHub, and it must be under
# 12 hours old.
# FT_PUBLISH=notes commits and pushes family-tree-private's _work/ folder only (a long task's running
# notes), and the source archive's own commits: no other private file, no site commit, no lock. It is the
# checkpoint during long work, and the way to keep the notes when a finish stopped.
#
#  1. stops if setup has not finished in this session, if a rebase or merge is unfinished, if a private
#     file sits outside family-tree-private (it would vanish with the machine), if a link was replaced by
#     a real file (a tool rewrote it by rename), or if the source archive has uncommitted changes
#  2. stops if site files are changed but not committed (the change loop commits them: gate + hook)
#  3. finds this session's own site commits (those on top of the newest published or queued commit)
#     and stops BEFORE pushing anything when they cannot go out: other site work came in under them, a
#     commit a queue rebuild dropped, a message the airlock refuses or that names someone, a payload the
#     gate did not pass, no writer lock; for the queue also a QUEUE CONFLICT, more than the airlock's 30
#     commits, a merge, a file it does not publish; for direct also unpublished commits in the queue
#  4. pushes the source archive's own commits (the evidence a payload cites), then commits family-tree-
#     private and pushes it, with the writer lock still held (so no other session starts from a queue without
#     these commits); when there are own site commits, .public-head = the newest of them
#  5. queues the own site commits (or, direct, pushes them)
#  6. releases the writer lock if <who> holds it, and pushes that; then (direct) waits for the live site
# A stop up to 4 pushes nothing but, possibly, the archive's commits (exit 1; a state commit 4 could not
# push is undone, its changes kept). A failure at 5 is a STATE SPLIT (exit 2): OPERATING.md, 'State split'.

set -uo pipefail
[ -f "$HOME/.ft-env" ] && . "$HOME/.ft-env"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/cloud-lib.sh" ] || { printf '\nFINISH STOPPED: cloud-lib.sh is missing next to cloud-finish.sh\n  Nothing was pushed.\n\n' >&2; exit 1; }
. "$HERE/cloud-lib.sh"
FT="${FT_DIR:?run cloud-setup.sh first}"; PRIV="${FT_PRIVATE_DIR:?run cloud-setup.sh first}"
ARCH="${FT_ARCHIVE:-}"; [ -n "$ARCH" ] && [ -e "$ARCH/.git" ] || ARCH=""
SITE="${SITE:-https://family.corynitschelm.com/}"
PUBLISH="${FT_PUBLISH:-queue}"
QUEUE_MAX=30                                # the airlock's MAX_COMMITS (family-tree-airlock, rules.py)
msg="${1:?usage: cloud-finish.sh \"<one-line message>\" [\"<who>\"]}"; who="${2:-}"
ARCH_PUSHED=0
die() { # $1 = message, $2 = exit code (1: nothing pushed; 2: STATE SPLIT)
  local tail=""
  if [ "${2:-1}" = 1 ]; then
    if [ "$ARCH_PUSHED" = 1 ]; then tail="
  Nothing else was pushed (only the source archive's own commits went up)."
    else tail="
  Nothing was pushed."; fi
  fi
  printf '\nFINISH STOPPED: %s%s\n\n' "$1" "$tail" >&2; exit "${2:-1}"
}
retry() { local i; for i in 1 2 3 4; do "$@" && return 0; sleep $(( ${FT_RETRY_WAIT:-1} * 2**i )); done; return 1; }   # FT_RETRY_WAIT=0: tests
short() { git -C "$FT" rev-parse --short "$1"; }
NOTES_HINT='Keep the notes first:  FT_PUBLISH=notes bash tools/cloud-finish.sh "Save research notes"'
case "$msg" in *$'\n'*) die "the message must be one line" ;; esac
[ "${FT_READONLY:-0}" != 1 ] || die "this session was set up read-only (FT_READONLY=1): it pushes nothing"
case "$PUBLISH" in queue|direct|notes) ;; *) die "FT_PUBLISH must be queue, direct or notes" ;; esac
for r in "$PRIV" "$FT" ${ARCH:+"$ARCH"}; do
  ft_midop "$r" && die "$(basename "$r") has an unfinished rebase or merge, or files left in conflict
  (git -C \"$r\" status). Finish or undo it (git rebase --abort, git merge --abort) first."
done
PRIV_URL="$(git -C "$PRIV" remote get-url origin)" || die "family-tree-private has no origin"

push_archive() { # the source archive's own commits (hand copies, urls.tsv), before anything that cites them
  [ -n "$ARCH" ] || return 0
  git -C "$ARCH" fetch -q origin main 2>/dev/null || die "cannot reach GitHub (the source archive)"
  [ "$(git -C "$ARCH" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)" -gt 0 ] || return 0
  local rc=0; ft_push_main "$ARCH" || rc=$?
  case $rc in
    0) ARCH_PUSHED=1; echo "archive: pushed family-tree-sources $(git -C "$ARCH" rev-parse --short HEAD)" ;;
    2) die "the source archive could not be pushed: GitHub's newer commits change the same files ($FT_CONFLICTS).
  Its commits are as they were; look at what came in (git -C \"$ARCH\" log HEAD..origin/main)." ;;
    *) die "the source archive could not be pushed (GitHub out of reach?): run this again" ;;
  esac
}

# ------------------------------------------------------------------ the notes checkpoint (FT_PUBLISH=notes)
if [ "$PUBLISH" = notes ]; then
  push_archive
  [ -d "$PRIV/_work" ] || { echo "notes: family-tree-private has no _work folder: nothing to save"; exit 0; }
  git -C "$PRIV" rev-parse -q --verify '@{upstream}' >/dev/null || die "family-tree-private's branch does not follow GitHub"
  git -C "$PRIV" add -A -- _work || die "could not stage _work"
  if git -C "$PRIV" diff --cached --quiet -- _work; then echo "notes: nothing new in _work"
  else git -C "$PRIV" commit -q -m "$msg" -- _work || die "the notes commit failed"; fi
  other=$(git -C "$PRIV" log --name-only --format= '@{upstream}..HEAD' | grep -v -e '^$' -e '^_work/' -e '^ledger/LOCK$' | sort -u | head -5 | tr '\n' ' ')
  [ -z "$other" ] || die "family-tree-private has unpushed commits that are not notes ($other). They may be a state the
  site does not have, so the checkpoint does not push them: finish with cloud-finish.sh (no FT_PUBLISH)."
  [ "$(git -C "$PRIV" rev-list --count '@{upstream}..HEAD')" -gt 0 ] || exit 0
  rc=0; ft_push_main "$PRIV" || rc=$?
  case $rc in
    0) echo "notes: pushed family-tree-private $(git -C "$PRIV" rev-parse --short HEAD)"; exit 0 ;;
    2) die "the notes could not be pushed: GitHub's newer commits change the same files ($FT_CONFLICTS).
  Everything here is as it was (the notes committed, other changes uncommitted). Look at what came in
  (git -C \"$PRIV\" log HEAD..origin/main), or finish (which commits everything first)." ;;
    *) die "the notes could not be pushed (GitHub out of reach?); they are committed here: run this again" ;;
  esac
fi

# the notes checkpoint above works in any session that has set up once (~/.ft-env); everything below needs
# setup to have finished in this session (a setup that stopped since took the mark away)
ft_ready || die "cloud-setup.sh has not finished in this session. Run it; if it stopped, do what it said (it may be
  PUBLISH BLOCKED, QUEUE CONFLICT or STATE SPLIT, which an interactive session clears with Cory)."

# ------------------------------------------------------------------ 1. nothing private outside the private repo
SESSION_LOCAL=" data.json .data-stamp .gate-stamp .research-stamp .password .owner-key index.html.new _to_delete node_modules "
REBUILT=" checks/claim-index.json checks/diff.json checks/findings.json checks/pin-audit.json "
orphans=""
while IFS= read -r top; do
  [ -z "$top" ] && continue
  [ -L "$FT/$top" ] && continue
  case "$SESSION_LOCAL" in *" $top "*) continue ;; esac
  [ -n "$(git -C "$FT" ls-files -- "$top" | head -1)" ] && continue      # a public folder
  orphans="$orphans $top"
done < <(git -C "$FT" ls-files --others --ignored --exclude-standard --directory | sed 's#/$##' | awk -F/ '{print $1}' | sort -u)
[ -z "$orphans" ] || die "private file(s) outside family-tree-private:$orphans
  Move each into family-tree-private, add it to .private-paths, and run cloud-setup.sh to link it."
while IFS= read -r name || [ -n "$name" ]; do
  name="${name%$'\r'}"; name="${name%/}"; case "$name" in ''|'#'*) continue ;; esac
  [ -L "$FT/$name" ] || die "$name is no longer a link into family-tree-private (a tool replaced it).
  Compare $FT/$name with $PRIV/$name, keep the right one in family-tree-private, then run cloud-setup.sh."
done < "$PRIV/.private-paths"
inside=$(git -C "$FT" ls-files --others --ignored --exclude-standard | while IFS= read -r f; do
  t=${f%%/*}; [ "$t" != "$f" ] && [ ! -L "$FT/$t" ] && [ ! -L "$FT/$f" ] && case "$REBUILT" in *" $f "*) false ;; *) true ;; esac \
    && [ -n "$(git -C "$FT" ls-files -- "$t" | head -1)" ] && echo "$f"; done)
[ -z "$inside" ] || printf 'note: ignored files inside public folders (lost with the machine unless moved):\n%s\n' "$(printf '%s\n' "$inside" | sed 's/^/  /')"
if [ -n "$ARCH" ] && [ -n "$(git -C "$ARCH" status --porcelain)" ]; then
  die "the source archive (family-tree-sources) has uncommitted changes: $(git -C "$ARCH" status --porcelain | head -3 | cut -c4- | tr '\n' ' ')
  A copy that is cited must be committed there (it would vanish with the machine): commit it
  (git -C \"$ARCH\" add <files> && git -C \"$ARCH\" commit -m \"add hand copies of new sources\"), or put it back."
fi

# ------------------------------------------------------------------ 2. the site is committed
[ -z "$(git -C "$FT" status --porcelain --untracked-files=no)" ] \
  || die "site files are changed but not committed. Finish the change loop (gate, then commit) first, or put them
  back (git -C \"$FT\" checkout -- index.html stats.json media)."

# ------------------------------------------------------------------ 3. this session's own site commits, and whether they can go out
git -C "$FT" fetch -q origin main || die "cannot reach GitHub (fetch the public main)"
git -C "$PRIV" fetch -q origin main || die "cannot reach GitHub (fetch family-tree-private)"
lr=0; git ls-remote --exit-code "$PRIV_URL" refs/heads/site-queue >/dev/null 2>&1 || lr=$?
queue=""
case $lr in
  0) git -C "$FT" fetch -q "$PRIV_URL" "+refs/heads/site-queue:refs/remotes/queue/site-queue" || die "cannot fetch the queue"
     queue="$(git -C "$FT" rev-parse refs/remotes/queue/site-queue)" ;;
  2) git -C "$FT" update-ref -d refs/remotes/queue/site-queue 2>/dev/null || true ;;     # there is no queue yet
  *) die "cannot reach family-tree-private (looking for the queue)" ;;
esac
M="$(git -C "$FT" rev-parse origin/main)"; H="$(git -C "$FT" rev-parse HEAD)"; N="$(ft_newest "$FT")"
pending=0                                  # queued, not yet published
if [ -n "$queue" ] && ! git -C "$FT" merge-base --is-ancestor "$queue" "$M"; then
  pending=$(git -C "$FT" rev-list --count "$M..$queue")
fi
if git -C "$FT" merge-base --is-ancestor "$H" "$N"; then
  own=0                                    # everything here is published or queued already: the state only
elif git -C "$FT" merge-base --is-ancestor "$N" "$H"; then
  own=$(git -C "$FT" rev-list --count "$N..$H")
else
  die "this session's site commits are not on top of the newest published or queued site commit ($(short "$N")):
  other site work came in under them (a direct push, or a session without the writer lock). Never merge or
  rebase the site (a payload commit carries the whole payload). $NOTES_HINT
  Then release the writer lock and redo the site work in a new session, which starts from the newer commit."
fi
IFS='|' read -r lw ls lage < <(ft_lock_on_github "$PRIV")
blocked=""
if [ "$own" -gt 0 ]; then
  if [ "$PUBLISH" = queue ]; then
    if [ -n "$queue" ] && ! git -C "$FT" merge-base --is-ancestor "$queue" "$H"; then
      die "QUEUE CONFLICT: the queue ($(short "$queue")) is not under this session's site commits.
  $NOTES_HINT
  Then stop: an interactive session sorts the queue out with Cory (OPERATING.md, 'A refused queue')."
    fi
    [ $((pending + own)) -le "$QUEUE_MAX" ] || die "the queue would hold $((pending + own)) commits; the airlock checks at most $QUEUE_MAX at a time
  (it would refuse them all). Wait until it has published the $pending waiting, then run this again. $NOTES_HINT"
  else
    [ "$pending" -eq 0 ] || die "the queue holds $pending commit(s) the airlock has not published yet: a direct push
  now would publish them unchecked. Wait for the airlock (or run it by hand), then push directly."
  fi
  guard="$FT/tools/check-commit-msg.js"; gm="$(mktemp)"; page=0
  for c in $(git -C "$FT" rev-list --reverse "$N..$H"); do
    if [ "$PUBLISH" = queue ]; then
      [ "$(git -C "$FT" rev-list --parents -n 1 "$c" | wc -w)" -eq 2 ] \
        || die "commit $(short "$c") is a merge: the airlock publishes no merge. $NOTES_HINT"
      bad=$(git -C "$FT" diff-tree --no-commit-id -r --no-renames --name-only "$c" \
        | grep -vxE 'index\.html|stats\.json|media/[a-z0-9][a-z0-9-]{0,63}\.bin' | head -3 | tr '\n' ' ')
      if [ -z "$bad" ] && ! git -C "$FT" diff --quiet "$c^" "$c" -- index.html; then   # one line changed: the payload's
        ns=$(git -C "$FT" diff --numstat "$c^" "$c" -- index.html | cut -f1,2)
        enc=$(git -C "$FT" diff -U0 "$c^" "$c" -- index.html | grep -cE '^[-+][[:space:]]*const ENC = \{')
        { [ "$ns" = $'1\t1' ] && [ "$enc" -eq 2 ]; } || bad="index.html (outside its payload line)"
      fi
      [ -z "$bad" ] || die "commit $(short "$c") changes $bad, which the airlock does not publish (only the payload
  line of index.html, stats.json and media/*.bin). A tool, test or document change goes out from an
  interactive session with Cory (FT_PUBLISH=direct); a routine brings it back as a card. $NOTES_HINT"
    fi
    if p="$(ft_msg_problem "$FT" "$c")"; then
      die "commit $(short "$c"): $p. Commit messages are public and the airlock refuses this one. To redo this
  session's own commits as one: git -C \"$FT\" reset --soft $(short "$N"), then commit again with one neutral line."
    fi
    git -C "$FT" log -1 --format=%s "$c" > "$gm"
    out="$(cd "$FT" && node "$guard" "$gm" 2>&1)" || { rm -f "$gm"; die "commit $(short "$c"): the commit guard refuses its message:
$(printf '%s\n' "$out" | grep -v '^$' | head -4 | sed 's/^/  /')
  To redo this session's own commits as one: git -C \"$FT\" reset --soft $(short "$N"), then commit again with one
  neutral line (if the guard could not build its name index, run node tools/crypt.js decrypt first)."; }
    git -C "$FT" diff --quiet "$c^" "$c" -- index.html || page=1
  done
  rm -f "$gm"
  if [ "$page" = 1 ]; then
    iv=$(git -C "$FT" show HEAD:index.html | grep -o 'const ENC = {v:[0-9]*, iter:[0-9]*, salt:"[^"]*", iv:"[^"]*"' | head -n 1 | sed 's/.*iv:"//; s/"$//')
    st=$(head -n 1 "$FT/.gate-stamp" 2>/dev/null | tr -d '\r')
    [ -n "$iv" ] && [ "$st" = "$iv" ] || die "the payload of $(short "$H") is not the one checks/gate.js last passed (iv ${iv:-?};
  .gate-stamp says ${st:-nothing}). Run node checks/gate.js on it; never publish a payload the gate has not passed."
  fi
  hrc=0; d="$(ft_holds_refused "$FT" "$PRIV_URL" "$queue")" || hrc=$?
  [ "$hrc" = 0 ] && die "this site clone holds commit $(printf %.7s "$d"), which the airlock refused, and the queue no longer does (it
  was rebuilt without it): it must never be queued again. $NOTES_HINT Then redo the work in a new session."
  [ "$hrc" = 2 ] && die "the airlock's verdict could not be read (GitHub out of reach?): run this again in a few minutes."
  if d="$(ft_dropped "$FT" "$PRIV")"; then
    die "this site clone holds commit $(printf %.7s "$d"), which a rebuild of the queue dropped (family-tree-private's
  .dropped-site-commits): it must never be queued again. $NOTES_HINT Then redo the work in a new session."
  fi
  if [ -z "$who" ]; then
    die "site commits go out only under the writer lock: name its holder (cloud-finish.sh \"<line>\" \"<who>\")."
  elif [ "$lw" = free ]; then
    die "this session does not hold the writer lock (it is free on GitHub). Take it (bash tools/cloud-lock.sh take
  \"$who\" \"<what>\"), which checks that nothing came in under these commits, then run this again."
  elif [ "$lw" != "$who" ]; then
    die "the writer lock is held by \"$lw\" (since $ls), not by \"$who\": site commits go out only under it.
  $NOTES_HINT"
  elif ! python3 -I -c 'import sys; sys.exit(0 if float(sys.argv[1]) < 12 else 1)' "${lage:-99}"; then
    die "the writer lock of \"$who\" is $lage hours old: another session may take it over. Renew it (bash tools/cloud-lock.sh
  take \"$who\" \"<what>\"), then run this again."
  fi
  if [ "$PUBLISH" = queue ]; then
    frc=0; rule="$(ft_refused "$FT" "$PRIV_URL" "$queue")" || frc=$?
    [ "$frc" = 0 ] && blocked="$rule"
    [ "$frc" = 2 ] && die "the airlock's verdict could not be read (GitHub out of reach?): run this again in a few minutes."
  fi
fi

# ------------------------------------------------------------------ 4. the evidence, then the state (the writer lock is released in 6)
push_archive
holds=0; [ -n "$who" ] && [ "$lw" = "$who" ] && holds=1
[ "$own" -gt 0 ] && printf '%s\n' "$H" > "$PRIV/.public-head"
git -C "$PRIV" add -A || die "could not stage family-tree-private"
made=0
if ! git -C "$PRIV" diff --cached --quiet; then git -C "$PRIV" commit -q -m "$msg" || die "the private commit failed"; made=1; fi
if [ "$(git -C "$PRIV" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 1)" -gt 0 ]; then
  rc=0; ft_push_main "$PRIV" || rc=$?
  case $rc in
    0) echo "state: pushed family-tree-private $(git -C "$PRIV" rev-parse --short HEAD)" ;;
    2) [ "$made" = 1 ] && git -C "$PRIV" reset -q --soft HEAD~1
       die "family-tree-private could not be pushed: GitHub has newer commits that change the same files
  ($FT_CONFLICTS). This session's state is uncommitted again. Look at what came in
  (git -C \"$PRIV\" log HEAD..origin/main) before going on. $NOTES_HINT" ;;
    *) [ "$made" = 1 ] && git -C "$PRIV" reset -q --soft HEAD~1
       die "family-tree-private could not be pushed (GitHub out of reach?); this session's state is uncommitted
  again. Run this again." ;;
  esac
else
  echo "state: nothing new"
fi

# ------------------------------------------------------------------ 6. the writer lock (run after 5: released last)
unlock() {
  [ "$holds" = 1 ] || return 0
  bash "$HERE/cloud-lock.sh" release "$who" || echo "WARNING: the writer lock was not released: run  bash tools/cloud-lock.sh release \"$who\""
}

# ------------------------------------------------------------------ 5. the site
if [ "$own" -eq 0 ]; then echo "site: nothing new to publish"; unlock; exit 0; fi
if [ "$PUBLISH" = queue ]; then
  retry git -C "$FT" push -q "$PRIV_URL" HEAD:refs/heads/site-queue \
    || die "STATE SPLIT: the state is pushed but the site is NOT queued ($(short "$H") is on this machine only).
  Try once more:  git -C \"$FT\" push \"$PRIV_URL\" HEAD:refs/heads/site-queue
  If it still fails, follow OPERATING.md, 'State split', before this machine is gone." 2
  git -C "$FT" update-ref refs/remotes/queue/site-queue "$H"
  echo "site: queued $own new commit(s) (head $(short "$H"); $((pending + own)) wait for the airlock). It checks and"
  echo "  publishes them within about two hours; its verdict is in family-tree-private's branch airlock-status."
  [ -z "$blocked" ] || echo "WARNING: the airlock has refused the queue under these commits (rule: $blocked): nothing in it is
  published until an interactive session clears it with Cory (OPERATING.md, 'A refused queue')."
  unlock
  exit 0
fi
retry git -C "$FT" push -q origin HEAD:main \
  || die "STATE SPLIT: the state is pushed but the site is NOT ($(short "$H") is on this machine only).
  Try once more:  git -C \"$FT\" push origin HEAD:main
  If it still fails, follow OPERATING.md, 'State split', before this machine is gone." 2
echo "site: pushed $own commit(s) directly, main at $(short "$H")"
unlock
[ "${FT_SKIP_LIVE:-0}" = 1 ] && { echo "live: check skipped (FT_SKIP_LIVE=1)"; exit 0; }
want=$(grep -o 'const ENC = {v:[0-9]*, iter:[0-9]*, salt:"[^"]*", iv:"[^"]*"' "$FT/index.html" | head -n 1 | sed 's/.*iv:"//; s/"$//')
for i in $(seq 1 30); do
  got=$(curl -fsS --max-time 20 "$SITE" 2>/dev/null | grep -o 'const ENC = {v:[0-9]*, iter:[0-9]*, salt:"[^"]*", iv:"[^"]*"' | head -n 1 | sed 's/.*iv:"//; s/"$//')
  [ "$got" = "$want" ] && { echo "live: the site serves this payload (iv $want)"; exit 0; }
  sleep 20
done
echo "live: NOT confirmed after 10 minutes (serving iv ${got:-nothing}, expected $want). Check the verify-deploy run; do not re-encrypt."
exit 3
