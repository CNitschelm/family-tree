#!/usr/bin/env bash
# cloud-lock.sh — one writer at a time, across cloud sessions.
#
#   bash tools/cloud-lock.sh status
#   bash tools/cloud-lock.sh take "<who>" "<what>" [--steal]
#   bash tools/cloud-lock.sh release "<who>"
#
# tools/lock.js keeps the lock in ledger/LOCK, which lives in family-tree-private. Each cloud session
# has its own copy, so a lock only counts once it is pushed: `take` commits ledger/LOCK and pushes it;
# if someone else changed the lock on GitHub first, `take` is refused (newer commits that leave the
# lock alone are fine: the lock commit goes on top of them). Taking it again under the same name renews
# it. A lock older than 12 hours counts as abandoned and is simply taken; --steal takes over a younger
# one, from a session that is gone (tools/lock.js).
# `take` refuses before cloud-setup.sh has finished, in the middle of a rebase, while the airlock has
# refused the queue (PUBLISH BLOCKED), while the queue is out of line with public main (QUEUE CONFLICT),
# and when this clone holds a commit a queue rebuild dropped or the airlock refused. Other uncommitted
# private changes may stay (a stretch whose lock ran out renews it, then finishes): the lock commit holds
# ledger/LOCK alone. Once the lock is pushed it looks at the queue
# AGAIN (the holder before may have queued work just before letting go), then brings the site clone up to
# the newest published or queued commit and rebuilds data.json, so the stretch starts from all of it.
# cloud-finish.sh releases the lock only after it has queued the site, so nobody takes it in between.
# `take` puts FT_WHO=<who> in ~/.ft-env (every new shell reads it), so tools/change.js and checks/gate.js
# recognise the holder; `release` removes it.

set -uo pipefail
[ -f "$HOME/.ft-env" ] && . "$HOME/.ft-env"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/cloud-lib.sh" ] || { echo "REFUSED: cloud-lib.sh is missing next to cloud-lock.sh"; exit 1; }
. "$HERE/cloud-lib.sh"
FT="${FT_DIR:?run cloud-setup.sh first}"; PRIV="${FT_PRIVATE_DIR:?run cloud-setup.sh first}"
steal=""; args=()
for a in "$@"; do if [ "$a" = --steal ]; then steal=--steal; else args+=("$a"); fi; done
cmd="${args[0]:-status}"; who="${args[1]:-}"; what="${args[2]:-}"
refuse() { echo "REFUSED: $*"; exit 1; }
lockjs() { (cd "$FT" && node tools/lock.js "$@"); }
PRIV_URL="$(git -C "$PRIV" remote get-url origin 2>/dev/null)" || refuse "family-tree-private has no origin"
qfetch() { # public main, the queue and family-tree-private's main, as GitHub has them now
  git -C "$FT" fetch -q origin main 2>/dev/null || return 1
  git -C "$PRIV" fetch -q origin main 2>/dev/null || return 1
  local lr=0; git ls-remote --exit-code "$PRIV_URL" refs/heads/site-queue >/dev/null 2>&1 || lr=$?
  case $lr in
    0) git -C "$FT" fetch -q "$PRIV_URL" "+refs/heads/site-queue:refs/remotes/queue/site-queue" 2>/dev/null || return 1 ;;
    2) git -C "$FT" update-ref -d refs/remotes/queue/site-queue 2>/dev/null || true ;;
    *) return 1 ;;
  esac
}
queue_head() { git -C "$FT" rev-parse -q --verify refs/remotes/queue/site-queue 2>/dev/null || true; }
qproblem() { # after qfetch: prints why no stretch may start now, and returns 0; returns 1 when none
  local frc=0 rule n d
  rule="$(ft_refused "$FT" "$PRIV_URL" "$(queue_head)")" || frc=$?
  if [ "$frc" = 0 ]; then echo "PUBLISH BLOCKED: the airlock refused the queued site commits (rule: ${rule:-?}). Nothing more may be
  queued until an interactive session clears it with Cory (OPERATING.md, 'A refused queue')."; return 0; fi
  if [ "$frc" = 2 ]; then echo "the airlock's verdict on the queue could not be read (GitHub out of reach?): try again in a few minutes"; return 0; fi
  local hrc=0; d="$(ft_holds_refused "$FT" "$PRIV_URL" "$(queue_head)")" || hrc=$?
  if [ "$hrc" = 0 ]; then echo "this site clone holds commit $(printf %.7s "$d"), which the airlock refused, and the queue no longer
  does (it was rebuilt without it): start a new session; never queue it again."; return 0; fi
  if [ "$hrc" = 2 ]; then echo "the airlock's verdict on the queue could not be read (GitHub out of reach?): try again in a few minutes"; return 0; fi
  if ft_conflict "$FT"; then echo "QUEUE CONFLICT: the queue is not on top of public main. An interactive session sorts it out with Cory
  (OPERATING.md, 'A refused queue')."; return 0; fi
  if d="$(ft_dropped "$FT" "$PRIV")"; then echo "this site clone holds commit $(printf %.7s "$d"), which a rebuild of the queue dropped
  (.dropped-site-commits): start a new session; never queue it again."; return 0; fi
  n="$(ft_newest "$FT")"
  git -C "$FT" merge-base --is-ancestor "$n" HEAD && return 1
  git -C "$FT" merge-base --is-ancestor HEAD "$n" && return 1
  echo "this site clone has commits that are not queued, and newer site work was queued or published meanwhile.
  Finish (bash tools/cloud-finish.sh) before taking the lock again, or redo the work in a new session."
  return 0
}
site_catch_up() { # with the lock held: start the stretch from the newest site commit (another session may have queued work)
  local n; n="$(ft_newest "$FT")"
  [ "$(git -C "$FT" rev-parse HEAD)" != "$n" ] && git -C "$FT" merge-base --is-ancestor HEAD "$n" || return 0
  git -C "$FT" merge -q --ff-only "$n" || { echo "WARNING: could not move the site up to $n: run cloud-setup.sh again"; return 0; }
  echo "site: moved up to $(git -C "$FT" rev-parse --short HEAD) (newer site work, published or queued)"
  if [ -e "$FT/data.json" ]; then   # no edit is made before the lock is taken, so data.json holds nothing unsaved
    mkdir -p "$HOME/.ft-tmp" && cp -p "$FT/data.json" "$HOME/.ft-tmp/data.json.before-lock"
    if (cd "$FT" && node tools/crypt.js decrypt >/dev/null 2>&1); then echo "data.json: rebuilt from the newer payload (the old copy: ~/.ft-tmp/data.json.before-lock)"
    else echo "WARNING: data.json is stale and decrypt failed: run node tools/crypt.js decrypt before any edit"; fi
  fi
}
setwho() { # $1 = the holder, or empty to remove; rewrites ~/.ft-env's FT_WHO line
  [ -f "$HOME/.ft-env" ] || return 0
  grep -v '^export FT_WHO=' "$HOME/.ft-env" > "$HOME/.ft-env.new" || true
  [ -z "$1" ] || printf 'export FT_WHO=%q\n' "$1" >> "$HOME/.ft-env.new"
  mv "$HOME/.ft-env.new" "$HOME/.ft-env"
}
do_release() { # $1 = holder. 0 released (or already free); 1 not pushed (FT_WHY says why)
  local gh rc=0
  FT_WHY=""
  ft_midop "$PRIV" && { FT_WHY="family-tree-private has an unfinished rebase or merge, or files left in conflict"; return 1; }
  lockjs release "$1" $steal >/dev/null || { FT_WHY="tools/lock.js refused (see above)"; return 1; }
  git -C "$PRIV" add ledger/LOCK || { FT_WHY="could not stage ledger/LOCK"; return 1; }
  if git -C "$PRIV" diff --cached --quiet -- ledger/LOCK; then
    git -C "$PRIV" fetch -q origin main 2>/dev/null || true
    gh="$(ft_lock_on_github "$PRIV")"
    case "$gh" in
      free) setwho ""; echo "already free"; return 0 ;;
      "$1|"*) [ "$(git -C "$PRIV" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)" -gt 0 ] \
                || { FT_WHY="GitHub shows the lock held by \"$1\" but this clone has it free: run cloud-setup.sh, then release again"; return 1; } ;;
      *) setwho ""; echo "free here; GitHub shows it held by \"${gh%%|*}\" (not this session's to release)"; return 0 ;;
    esac
  else
    git -C "$PRIV" commit -q -m "Release the writer lock" -- ledger/LOCK || { FT_WHY="could not commit ledger/LOCK"; return 1; }
  fi
  ft_push_main "$PRIV" || rc=$?
  case $rc in
    0) setwho ""; echo "lock released and pushed"; return 0 ;;
    2) git -C "$PRIV" reset -q --keep HEAD~1 2>/dev/null || true
       ft_ff "$PRIV" || true
       setwho ""
       FT_WHY="the lock changed on GitHub meanwhile (taken over or released by someone else); nothing released: $(lockjs status)"
       return 1 ;;
    *) FT_WHY="the release is committed but NOT pushed (GitHub out of reach?): run this again"; return 1 ;;
  esac
}

case "$cmd" in
  status)   # the lock as GitHub has it (the one that counts), and as this clone has it
    git -C "$PRIV" fetch -q origin main 2>/dev/null || echo "WARNING: could not fetch family-tree-private"
    echo "GitHub: $(git -C "$PRIV" show origin/main:ledger/LOCK 2>/dev/null | head -c 400)"
    echo "here:   $(lockjs status)" ;;
  take)
    [ -n "$who" ] || { echo 'usage: cloud-lock.sh take "<who>" "<what>" [--steal]'; exit 2; }
    [ "${FT_READONLY:-0}" != 1 ] || refuse "this session was set up read-only (FT_READONLY=1)"
    ft_ready || refuse "cloud-setup.sh has not finished in this session: run it (if it stopped, do what it said)"
    for r in "$PRIV" "$FT"; do
      ft_midop "$r" && refuse "$(basename "$r") has an unfinished rebase or merge, or files left in conflict (git -C \"$r\" status)"
    done
    # other uncommitted private changes may stay (a stretch whose lock ran out renews it, then finishes): the lock
    # commit holds ledger/LOCK alone, and the changes are set aside whenever newer commits come in
    git -C "$PRIV" diff --quiet HEAD -- ledger/LOCK 2>/dev/null || refuse "ledger/LOCK has uncommitted changes here: put it back (git -C \"$PRIV\" checkout HEAD -- ledger/LOCK)"
    [ -z "$(git -C "$FT" status --porcelain --untracked-files=no)" ] || refuse "the site has uncommitted changes: take the lock before changing site files"
    qfetch || refuse "cannot reach GitHub (public main, the queue, family-tree-private)"
    why="$(qproblem)" && refuse "$why"
    ft_ff "$PRIV" || refuse "family-tree-private cannot fast-forward to GitHub: $FT_WHY"
    lockjs take "$who" "$what" $steal >/dev/null || exit 1
    git -C "$PRIV" add ledger/LOCK || refuse "could not stage ledger/LOCK"
    git -C "$PRIV" diff --cached --quiet -- ledger/LOCK && refuse "ledger/LOCK did not change (tools/lock.js take wrote nothing)"
    git -C "$PRIV" commit -q -m "Take the writer lock" -- ledger/LOCK || refuse "could not commit ledger/LOCK"
    base="$(git -C "$PRIV" rev-parse HEAD~1)"; pushed=0; why="GitHub could not be reached"
    for i in 1 2 3; do
      if git -C "$PRIV" push -q origin HEAD:main 2>/dev/null; then pushed=1; break; fi
      sleep $((2 ** i))
      git -C "$PRIV" fetch -q origin main 2>/dev/null || continue
      if ! git -C "$PRIV" diff --quiet "$base" origin/main -- ledger/LOCK; then why="the lock changed on GitHub while taking it"; break; fi
      trc=0; ft_take_in "$PRIV" rebase || trc=$?
      [ "$trc" = 0 ] || { why="GitHub's newer commits could not be taken in (${FT_CONFLICTS:-$FT_WHY})"; break; }
      base="$(git -C "$PRIV" rev-parse HEAD~1)"
    done
    if [ "$pushed" = 0 ]; then
      git -C "$PRIV" reset -q --keep "$base" || true
      ft_ff "$PRIV" || true
      echo "REFUSED: $why. The lock is as GitHub has it:"; lockjs status; exit 1
    fi
    # the lock is ours: look at the queue again, since the holder before may have queued work just before letting go
    if ! qfetch; then why="cannot reach GitHub after taking the lock"
    elif why="$(qproblem)"; then :
    else why=""; fi
    if [ -n "$why" ]; then
      steal=""; do_release "$who" >/dev/null || echo "WARNING: the lock could not be released again: $FT_WHY"
      refuse "$why (the lock was taken and released again)"
    fi
    site_catch_up
    setwho "$who"
    echo "lock taken by \"$who\" and pushed (FT_WHO set in ~/.ft-env)" ;;
  release)
    [ -n "$who" ] || { echo 'usage: cloud-lock.sh release "<who>"'; exit 2; }
    do_release "$who" || refuse "$FT_WHY" ;;
  *)
    echo 'usage: cloud-lock.sh status | take "<who>" "<what>" [--steal] | release "<who>"'; exit 2 ;;
esac
