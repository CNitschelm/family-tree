#!/usr/bin/env bash
# cloud-setup.sh — make a cloud session ready to work on the family tree. Run it first, every
# session. Idempotent: running it again changes nothing that is already right.
#
#   bash cloud-setup.sh                    # finds the site clone itself
#   FT_DIR=<site clone> bash cloud-setup.sh
#
# Layout (the session's repositories, side by side):
#   family-tree/           the public site and its tools, with its FULL git history
#   family-tree-private/   the working state (research.json, ledger/, notes/, working/, ...)
#   family-tree-sources/   the source archive
# Every entry in family-tree-private/.private-paths is linked into family-tree/ at the same path:
# a top-level name (research.json, ledger, notes) or a file inside a public folder
# (checks/priority-cards.json). The tools then find everything where they always did. The one tool
# that rewrites a private file by rename (research.js) is pointed at the real file with FT_RESEARCH
# (~/.ft-env). FT_LEDGER is deliberately NOT exported: ledger/ is a folder link, so its writes land in
# the private repo anyway, and an exported FT_LEDGER makes tests/ledger.js read the real ledger.
#
# Needs FT_PASSWORD (environment variable). Optional: FT_OWNER_KEY (the content of .owner-key).
# The site clone: the one attached to the session if there is one (interactive sessions); otherwise
# (routines, which never get the public repo attached, so they cannot push to it) a read-only clone of
# the public repo. Site changes are published through the queue (cloud-finish.sh, the airlock); when
# the queue holds commits the airlock has not published yet, the site's main starts from them.
# FT_READONLY=1: a session that only reads (a report task). A refused or conflicting queue does not stop
# it (it stays on public main and says so), and ~/.ft-env carries FT_READONLY=1, so cloud-finish.sh refuses.
# Overrides for tests: FT_DIR, FT_PRIVATE_DIR, FT_PRIVATE_URL, FT_SOURCES_URL, FT_SITE_URL, FT_ARCHIVE, FT_SPLIT_WAIT,
# FT_SKIP_DECRYPT=1, FT_SKIP_TOOLS=1, and FT_ATTACH_DIR: the folder where the platform attaches a session's
# repositories (default /home/user), which the search below also looks in. The selftest points it at an
# empty folder, so that a test run inside a real session cannot find that session's clones.
# Stops (exit 1) instead of guessing. It never deletes, resets or pushes anything, and never prints
# a secret. It writes only its links, ~/.ft-env (and one line in ~/.bashrc and ~/.profile), and,
# when they are missing, data.json, .data-stamp and .owner-key.

set -euo pipefail
say()  { printf '  %s\n' "$*"; }
die()  { printf '\nSETUP STOPPED: %s\n\n' "$*" >&2; exit 1; }
clean_tracked() { [ -z "$(git -C "$1" status --porcelain --untracked-files=no)" ]; }
is_site() { [ -n "$1" ] && [ -f "$1/index.html" ] && [ -f "$1/tools/crypt.js" ] && [ -e "$1/.git" ]; }
relpath() { python3 -I -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$1" "$2"; }
tracks() { git -C "$1" rev-parse -q --verify '@{upstream}' >/dev/null 2>&1; }   # on a branch that follows GitHub
onto_main() { # $1 = repo. Cloud sessions start each clone on a session branch of their own (claude/...,
  # no upstream); put a clean clone on main, following origin/main. Commits on that branch stay on it.
  local r="$1"
  [ "$(git -C "$r" symbolic-ref -q --short HEAD || true)" = main ] && return 0
  clean_tracked "$r" || { say "NOTE: $(basename "$r") has uncommitted changes on $(git -C "$r" symbolic-ref -q --short HEAD || echo 'a detached HEAD'); left there"; return 0; }
  git -C "$r" fetch -q origin main || return 1
  if git -C "$r" show-ref --verify -q refs/heads/main; then git -C "$r" checkout -q main
  else git -C "$r" checkout -q -b main --track origin/main; fi
  git -C "$r" rev-parse -q --verify '@{upstream}' >/dev/null 2>&1 || git -C "$r" branch -q --set-upstream-to=origin/main main
}
ahead_of_up() { git -C "$1" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 1; }

echo "cloud-setup — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
LIB="$(cd "$(dirname "$0")" && pwd)/cloud-lib.sh"
[ -f "$LIB" ] || die "cloud-lib.sh is missing next to cloud-setup.sh"
. "$LIB"
rm -f "$HOME/.ft-ready"   # written last: cloud-lock.sh and cloud-finish.sh refuse to run until setup has finished

# ------------------------------------------------------------------ 0. where the clones are
ATTACH="${FT_ATTACH_DIR:-/home/user}"
if [ -n "${FT_DIR:-}" ]; then
  is_site "$FT_DIR" || die "FT_DIR=$FT_DIR is not a clone of the site (no index.html, tools/crypt.js or .git)"
  FT="$(cd -P "$FT_DIR" && pwd)"
else
  FT=""
  here="$(cd -P "$(dirname "$0")/.." 2>/dev/null && pwd || true)"
  for c in "$here" "$PWD" "$PWD/family-tree" "$(dirname "$PWD")/family-tree" "$ATTACH/family-tree" "$HOME/family-tree"; do
    if is_site "$c"; then FT="$(cd -P "$c" && pwd)"; break; fi
  done
  if [ -z "$FT" ]; then   # no site attached (a routine): clone the public repo, read-only, next to the private one
    p=""
    for c in "${FT_PRIVATE_DIR:-}" "$PWD" "$PWD/family-tree-private" "$ATTACH/family-tree-private" "$HOME/family-tree-private"; do
      [ -n "$c" ] && [ -e "$c/.git" ] && [ -f "$c/.private-paths" ] && { p="$(cd -P "$c" && pwd)"; break; }
    done
    [ -n "$p" ] || die "no clone of the site or of family-tree-private found (looked in $PWD, $ATTACH and $HOME); set FT_DIR"
    FT="$(dirname "$p")/family-tree"
    [ ! -e "$FT" ] || die "$FT exists but is not a clone of the site"
    git clone -q "${FT_SITE_URL:-https://github.com/CNitschelm/family-tree.git}" "$FT" \
      || die "could not clone the public site repo (read-only) into $FT"
    FT="$(cd -P "$FT" && pwd)"
    say "site: cloned the public repo read-only (it is not attached to this session, so nothing can be pushed to it)"
  fi
fi
BASE="$(dirname "$FT")"
pick() { # $1 = repo name, $2 = override; prints the first existing clone, else the sibling path
  local c
  if [ -n "$2" ]; then echo "$2"; return; fi
  for c in "$BASE/$1" "$ATTACH/$1" "$HOME/$1"; do [ -e "$c/.git" ] && { (cd -P "$c" && pwd); return; }; done
  echo "$BASE/$1"
}
PRIV="$(pick family-tree-private "${FT_PRIVATE_DIR:-}")"
SRC="$(pick family-tree-sources "${FT_ARCHIVE:-}")"
PRIV_URL="${FT_PRIVATE_URL:-https://github.com/CNitschelm/family-tree-private.git}"
SRC_URL="${FT_SOURCES_URL:-https://github.com/CNitschelm/family-tree-sources.git}"
say "site: $FT"

# ------------------------------------------------------------------ 1. the site repo
cd "$FT"
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  t0=$(date +%s)
  git fetch -q --unshallow origin 2>/dev/null || git fetch -q --depth=1000000 origin \
    || die "could not fetch the site's full history (the change guard reads every past payload)"
  say "fetched the full history in $(( $(date +%s) - t0 )) s"
fi
git fetch -q origin main || die "could not fetch origin/main"
clean_tracked "$FT" || die "the site folder has uncommitted changes to tracked files; commit or set them aside first"
if git show-ref --verify -q refs/heads/main; then
  [ "$(git symbolic-ref -q --short HEAD || true)" = main ] || git checkout -q main
  ahead=$(git rev-list --count origin/main..main); behind=$(git rev-list --count main..origin/main)
  if [ "$behind" -gt 0 ] && [ "$ahead" -gt 0 ]; then die "local main and origin/main have diverged ($ahead/$behind)"; fi
  if [ "$behind" -gt 0 ]; then git merge -q --ff-only origin/main; fi
else
  git checkout -q -b main origin/main
fi
git config core.hooksPath githooks
say "site: main at $(git rev-parse --short HEAD), full history ($(git rev-list --count HEAD) commits), commit hook on"

# ------------------------------------------------------------------ 2. the private state repo
if [ -e "$PRIV/.git" ]; then onto_main "$PRIV" || die "could not put family-tree-private on main"; fi
if [ ! -e "$PRIV/.git" ]; then
  git clone -q "$PRIV_URL" "$PRIV" || die "could not clone $PRIV_URL — is family-tree-private one of this session's repositories?"
elif ! tracks "$PRIV"; then
  say "NOTE: family-tree-private is not on a branch that follows GitHub; not pulled"
elif clean_tracked "$PRIV" && [ "$(ahead_of_up "$PRIV")" = 0 ]; then
  git -C "$PRIV" pull -q --ff-only || die "family-tree-private cannot fast-forward"
else
  say "NOTE: family-tree-private has local work in this session; not pulled"
fi
PRIV="$(cd -P "$PRIV" && pwd)"
[ -s "$PRIV/.private-paths" ] || die "family-tree-private has no .private-paths"
say "private: $PRIV at $(git -C "$PRIV" rev-parse --short HEAD), $(grep -cvE '^[[:space:]]*(#|$)' "$PRIV/.private-paths") entries"

# ------------------------------------------------------------------ 2b. the queue (site commits the airlock has not published yet)
RO="${FT_READONLY:-0}"
PRIV_URL_NOW="$(git -C "$PRIV" remote get-url origin)"
q=""
if git fetch -q "$PRIV_URL_NOW" "+refs/heads/site-queue:refs/remotes/queue/site-queue" 2>/dev/null; then
  q="$(git rev-parse refs/remotes/queue/site-queue)"
fi
if [ "$RO" != 1 ]; then   # a clone (on a machine used before) holding commits that must never be queued again
  if d="$(ft_dropped "$FT" "$PRIV")"; then
    die "this site clone holds commit $(printf %.7s "$d"), which a rebuild of the queue dropped (family-tree-private's
  .dropped-site-commits). Start from a fresh clone of the site; never queue it again."
  fi
  hrc=0; d="$(ft_holds_refused "$FT" "$PRIV_URL_NOW" "$q")" || hrc=$?
  [ "$hrc" = 0 ] && die "this site clone holds commit $(printf %.7s "$d"), which the airlock refused, and the queue no longer does (it was
  rebuilt without it). Start from a fresh clone of the site; never queue it again."
  [ "$hrc" = 2 ] && die "the airlock's verdict on the queue could not be read (family-tree-private's branch airlock-status; GitHub
  out of reach?). Run setup again in a few minutes; never work on a queue whose verdict is unknown."
fi
if [ -n "$q" ]; then
  if git merge-base --is-ancestor "$q" origin/main; then
    say "queue: nothing waiting (everything queued is published)"
  elif git merge-base --is-ancestor origin/main "$q"; then
    frc=0; rule="$(ft_refused "$FT" "$PRIV_URL_NOW" "$q")" || frc=$?
    if [ "$frc" = 0 ]; then
      if [ "$RO" = 1 ]; then
        say "queue: PUBLISH BLOCKED (the airlock refused it, rule: ${rule:-?}); read-only session: main stays at public main"
      else
        die "PUBLISH BLOCKED: the airlock refused the queued site commits (rule: ${rule:-?}). Nothing more may be queued
  until an interactive session clears it with Cory (OPERATING.md, 'A refused queue'). Do no site work in this session."
      fi
    elif [ "$frc" = 2 ]; then
      if [ "$RO" = 1 ]; then say "queue: the airlock's verdict could not be read; read-only session: main stays at public main"
      else die "the airlock's verdict on the queue could not be read (family-tree-private's branch airlock-status; GitHub
  out of reach?). Run setup again in a few minutes; never work on a queue whose verdict is unknown."; fi
    else
      [ "$(git symbolic-ref -q --short HEAD)" = main ] && git merge -q --ff-only "$q" || die "could not start main from the queue"
      say "queue: main starts from $(git rev-list --count origin/main..HEAD) queued commit(s) the airlock has not published yet"
    fi
  elif [ "$RO" = 1 ]; then
    say "queue: QUEUE CONFLICT (site-queue is not on top of public main); read-only session: main stays at public main"
  else
    die "QUEUE CONFLICT: family-tree-private's site-queue is not on top of public main (public main moved while
  commits waited). An interactive session rebuilds the queue on the new main (OPERATING.md, 'A refused queue');
  do no site work here."
  fi
fi

# ------------------------------------------------------------------ 2c. state and site belong together (checked before anything is written)
state_ok() { # .public-head names a site commit public main or the queue holds
  [ -s "$PRIV/.public-head" ] || return 0
  ph=$(tr -d '\r\n' < "$PRIV/.public-head")
  if git merge-base --is-ancestor "$ph" origin/main 2>/dev/null; then
    say "state matches the site (.public-head $(printf %.7s "$ph") is published)"
  elif [ -n "$q" ] && git merge-base --is-ancestor "$ph" "$q" 2>/dev/null; then
    say "state matches the site (.public-head $(printf %.7s "$ph") is queued)"
  else return 1; fi
}
if ! state_ok; then   # a session may be between its state push and its queue push: look once more
  sleep "${FT_SPLIT_WAIT:-20}"
  git fetch -q origin main || true
  if git fetch -q "$PRIV_URL_NOW" "+refs/heads/site-queue:refs/remotes/queue/site-queue" 2>/dev/null; then q="$(git rev-parse refs/remotes/queue/site-queue)"; fi
  state_ok || die "STATE SPLIT: family-tree-private records site commit $ph, which neither public main nor the queue contains.
  A session pushed its state but not the site. Follow OPERATING.md, 'State split', before any work."
fi

# ------------------------------------------------------------------ 3. the source archive
if [ -e "$SRC/.git" ]; then onto_main "$SRC" || say "NOTE: could not put family-tree-sources on main"; fi
if [ ! -e "$SRC/.git" ]; then
  git clone -q --depth 1 "$SRC_URL" "$SRC" || die "could not clone $SRC_URL — is family-tree-sources one of this session's repositories?"
elif tracks "$SRC" && clean_tracked "$SRC" && [ "$(ahead_of_up "$SRC")" = 0 ]; then
  git -C "$SRC" pull -q --ff-only || say "NOTE: family-tree-sources not updated (pull failed)"
fi
SRC="$(cd -P "$SRC" && pwd)"
say "sources: $SRC at $(git -C "$SRC" rev-parse --short HEAD)"

# ------------------------------------------------------------------ 4. link the private entries into the site folder
n=0
while IFS= read -r name || [ -n "$name" ]; do
  name="${name%$'\r'}"; name="${name%/}"
  case "$name" in ''|'#'*) continue ;; esac
  case "/$name/" in
    *'/../'*|*'/./'*|*'//'*) die ".private-paths lists '$name': not a plain relative path" ;;
    '/.git/'*|'/.github/'*)  die ".private-paths lists '$name', which is not allowed" ;;
  esac
  case "$name" in /*) die ".private-paths lists '$name': an absolute path" ;; esac
  [ -e "$PRIV/$name" ] || die ".private-paths lists '$name' but family-tree-private has no such entry"
  [ -z "$(git --literal-pathspecs ls-files -- "$name" | head -1)" ] || die "'$name' is tracked by the PUBLIC repo: refusing to shadow it"
  parent="$(dirname "$name")"
  if [ "$parent" != . ]; then   # a file inside a public folder: that folder must be a real, tracked one
    top="${name%%/*}"
    { [ -d "$FT/$top" ] && [ ! -L "$FT/$top" ] && [ -n "$(git --literal-pathspecs ls-files -- "$top" | head -1)" ]; } \
      || die "'$name': '$top' is not a public folder of the site, so list '$top' itself instead"
    [ -L "$FT/$parent" ] && die "'$name': '$parent' is a link"
    mkdir -p "$FT/$parent"
  fi
  git check-ignore -q --no-index -- "$name" || die "'$name' is NOT ignored by the public repo: it would be published"
  target="$(relpath "$PRIV/$name" "$FT/$parent")"
  if [ -L "$FT/$name" ]; then
    [ "$(readlink "$FT/$name")" = "$target" ] || die "$FT/$name links to $(readlink "$FT/$name"), expected $target"
  elif [ -e "$FT/$name" ]; then
    die "$FT/$name is a real file or folder: move it into family-tree-private first"
  else
    ln -s "$target" "$FT/$name"
  fi
  n=$((n+1))
done < "$PRIV/.private-paths"
[ -z "$(git status --porcelain)" ] || die "after linking, the public repo sees new files: $(git status --porcelain | head -3 | tr '\n' ' ')"
say "linked $n private entries into the site folder (all ignored by the public repo)"

# ------------------------------------------------------------------ 5. environment for every shell
cat > "$HOME/.ft-env" <<EOF
# written by cloud-setup.sh
export FT_DIR="$FT"
export FT_PRIVATE_DIR="$PRIV"
export FT_ARCHIVE="$SRC"
export FT_RESEARCH="$PRIV/research.json"
EOF
[ "$RO" = 1 ] && echo 'export FT_READONLY=1' >> "$HOME/.ft-env"
for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  grep -qs 'ft-env' "$rc" || printf '\n[ -f "$HOME/.ft-env" ] && . "$HOME/.ft-env"\n' >> "$rc"
done
. "$HOME/.ft-env"
say "wrote ~/.ft-env (FT_RESEARCH points into family-tree-private)"

# ------------------------------------------------------------------ 6. secrets and the working copy
if [ "${FT_SKIP_DECRYPT:-0}" != 1 ]; then
  [ -n "${FT_PASSWORD:-}" ] || die "FT_PASSWORD is not set: add it to this environment's variables"
  # tools/linkconf.js reads the owner key from .owner-key and MAKES A NEW ONE when the file is missing
  # (every device would then need its link again), so the key is written there, private (0600, ignored).
  if [ -n "${FT_OWNER_KEY:-}" ] && [ ! -e "$FT/.owner-key" ]; then
    git check-ignore -q --no-index -- .owner-key || die ".owner-key would not be ignored by the public repo: not written"
    ( umask 077; printf '%s\n' "$FT_OWNER_KEY" > "$FT/.owner-key" )
  fi
  [ -e "$FT/.owner-key" ] || say "NOTE: no FT_OWNER_KEY: never run tools/linkconf.js here (it would make a new owner key)"
  if [ -e "$FT/data.json" ]; then
    # never overwrite a working copy: it may hold applied, not yet encrypted edits (doctor checks it is current)
    say "data.json already here: left as it is"
  else
    node tools/crypt.js decrypt >/tmp/ft-decrypt.txt 2>&1 \
      || { tail -5 /tmp/ft-decrypt.txt >&2; die "node tools/crypt.js decrypt failed (a wrong FT_PASSWORD fails here)"; }
    say "decrypted the payload into data.json (stamped)"
  fi
fi

# ------------------------------------------------------------------ 7. health
if [ "${FT_SKIP_TOOLS:-0}" != 1 ]; then
  node tools/doctor.js >/tmp/ft-doctor.txt 2>&1 || { cat /tmp/ft-doctor.txt; die "tools/doctor.js reports a blocker"; }
  say "doctor: no blocker"
  say "lock: $(node tools/lock.js status)"
  node tools/research.js validate >/tmp/ft-research.txt 2>&1 || { cat /tmp/ft-research.txt; die "research.json does not validate"; }
  sed 's/^/  /' /tmp/ft-research.txt
fi
date -u +%Y-%m-%dT%H:%M:%SZ > "$HOME/.ft-ready"
echo "cloud-setup: ready."
