# cloud-lib.sh — functions shared by cloud-setup.sh, cloud-lock.sh and cloud-finish.sh. Sourced, never run.

# ft_verdict <family-tree-private url>: the airlock's latest verdict (family-tree-private's branch airlock-status).
# Prints "<result> <queue head> <rule>" (the rule's spaces as _) and returns 0; returns 1 when there is no
# verdict yet; 2 when it cannot be read (GitHub out of reach, a broken file): callers stop, never pass.
ft_verdict() {
  local url="$1" t st="" lr=0 out
  git ls-remote --exit-code "$url" refs/heads/airlock-status >/dev/null 2>&1 || lr=$?
  [ "$lr" = 2 ] && return 1
  [ "$lr" = 0 ] || return 2
  t="$(mktemp -d)"; git init -q "$t"
  if git -C "$t" fetch -q --depth 1 "$url" refs/heads/airlock-status 2>/dev/null; then
    st="$(git -C "$t" show FETCH_HEAD:status.json 2>/dev/null || true)"
  fi
  rm -rf "$t"
  [ -n "$st" ] || return 2
  out="$(printf '%s' "$st" | python3 -I -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: d=None
if not isinstance(d, dict): print("? - -")
else: print(d.get("result") or "-", d.get("queue_head") or "-", (d.get("rule") or "-").replace(" ", "_"))')"
  [ "${out%% *}" = "?" ] && return 2
  echo "$out"
}

# ft_refused <site clone> <family-tree-private url> <queue sha>. Returns
#   0  the queue holds commits the airlock refused (the verdict is "refused" for this queue or for one under
#      it); prints the rule;
#   1  it does not (no verdict yet, another verdict, or a refused queue the queue no longer contains: a
#      rebuilt queue is not blocked);
#   2  the verdict cannot be read: callers stop, never pass.
# Call it as  frc=0; rule="$(ft_refused ...)" || frc=$?  (a plain assignment would trip set -e).
ft_refused() {
  local v vrc=0 res head rule
  [ -n "$3" ] || return 1
  v="$(ft_verdict "$2")" || vrc=$?
  [ "$vrc" = 1 ] && return 1
  [ "$vrc" = 0 ] || return 2
  read -r res head rule <<< "$v"
  [ "$res" = refused ] || return 1
  git -C "$1" merge-base --is-ancestor "$head" "$3" 2>/dev/null || return 1
  echo "$rule"
}

# ft_holds_refused <site clone> <family-tree-private url> <queue sha, or empty>: the latest verdict refused a
# commit that this clone's HEAD still holds while the queue no longer does (an interactive session rebuilt the
# queue without it, and the airlock has not checked the new one yet). Prints that commit and returns 0; returns
# 1 when not; 2 when the verdict cannot be read (callers stop). Call it as  hrc=0; d="$(...)" || hrc=$?
ft_holds_refused() {
  local v vrc=0 res head rule
  v="$(ft_verdict "$2")" || vrc=$?
  [ "$vrc" = 1 ] && return 1
  [ "$vrc" = 0 ] || return 2
  read -r res head rule <<< "$v"
  [ "$res" = refused ] || return 1
  git -C "$1" merge-base --is-ancestor "$head" HEAD 2>/dev/null || return 1
  [ -n "$3" ] && git -C "$1" merge-base --is-ancestor "$head" "$3" 2>/dev/null && return 1
  echo "$head"
}

# ft_dropped <site clone> <private clone>: when a queue was rebuilt without some commits, their ids are
# listed in family-tree-private's .dropped-site-commits (one per line; as GitHub has it: origin/main, fetched
# by the caller). Prints the first one this site clone's HEAD still holds and returns 0; returns 1 when none.
ft_dropped() {
  local s
  while IFS= read -r s || [ -n "$s" ]; do
    s="${s%%[[:space:]#]*}"; [ -n "$s" ] || continue
    git -C "$1" merge-base --is-ancestor "$s" HEAD 2>/dev/null && { echo "$s"; return 0; }
  done < <(git -C "$2" show origin/main:.dropped-site-commits 2>/dev/null)
  return 1
}

# ft_midop <repo>: true when a rebase or a merge is unfinished there, or files are left in conflict.
ft_midop() {
  local g; g="$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)" || return 1
  [ -d "$g/rebase-merge" ] || [ -d "$g/rebase-apply" ] || [ -f "$g/MERGE_HEAD" ] || [ -n "$(git -C "$1" ls-files -u)" ]
}

# ft_clear_dups <repo>: before taking in origin/main (fetched by the caller): an UNTRACKED file here that the
# new commits add would stop git. One with the same bytes (the payload history cache that two sessions both
# built) is removed, since nothing is lost; one that differs is not touched: returns 1, FT_CONFLICTS names it.
ft_clear_dups() {
  local r="$1" f base
  FT_CONFLICTS=""
  base="$(git -C "$r" merge-base HEAD origin/main 2>/dev/null)" || return 0
  while IFS= read -r f; do
    [ -n "$f" ] && [ -e "$r/$f" ] || continue
    git -C "$r" ls-files --error-unmatch -- "$f" >/dev/null 2>&1 && continue          # tracked here: git handles it
    if [ "$(git -C "$r" hash-object -- "$f")" = "$(git -C "$r" rev-parse "origin/main:$f" 2>/dev/null)" ]; then rm -f -- "$r/$f"
    else FT_CONFLICTS="$FT_CONFLICTS$f "; fi
  done < <(git -C "$r" diff --name-only --diff-filter=A "$base" origin/main)
  [ -z "$FT_CONFLICTS" ]
}

# ft_take_in <repo> <ff|rebase>: bring in GitHub's newer commits (origin/main, fetched by the caller): a
# fast-forward (ff), or this clone's own commits rebased onto them (rebase). Uncommitted changes are set aside
# for it and put back after it. Returns 0 when done; 2 when they clash with the newer commits, or an untracked
# file here differs from one the newer commits add: everything is put back as it was, and FT_CONFLICTS names
# the files; 1 for anything else (FT_WHY says what git said).
ft_take_in() {
  local r="$1" how="$2" pre out rc=0
  FT_CONFLICTS=""; FT_WHY=""
  ft_clear_dups "$r" || return 2
  pre="$(git -C "$r" rev-parse HEAD)"
  if [ "$how" = ff ]; then out="$(git -C "$r" merge -q --ff-only --autostash origin/main 2>&1)" || rc=$?
  else out="$(git -C "$r" rebase -q --autostash origin/main 2>&1)" || rc=$?; fi
  if [ "$rc" != 0 ]; then
    if ft_midop "$r"; then
      FT_CONFLICTS="$(git -C "$r" diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ' ')"
      git -C "$r" rebase --abort 2>/dev/null || git -C "$r" merge --abort 2>/dev/null || true   # puts it all back
      return 2
    fi
    FT_WHY="$(printf '%s' "$out" | grep -v -e '^Created autostash' -e '^Applied autostash' | head -n 2 | tr '\n' ' ')"
    return 1
  fi
  if [ -n "$(git -C "$r" ls-files -u)" ]; then
    # it went through, but the set-aside uncommitted changes clash with the newer commits: put everything back
    # as it was (HEAD as before, the changes from the stash) and leave the newer commits out
    FT_CONFLICTS="$(git -C "$r" diff --name-only --diff-filter=U | tr '\n' ' ')"
    git -C "$r" reset -q --hard "$pre" && git -C "$r" stash pop -q >/dev/null 2>&1 || true
    return 2
  fi
  return 0
}

# ft_ff <repo>: fast-forward to GitHub's main, uncommitted changes kept. 0 when done; 1 otherwise, with the
# reason in FT_WHY.
ft_ff() {
  local r="$1" rc=0
  git -C "$r" fetch -q origin main 2>/dev/null || { FT_WHY="GitHub could not be reached"; return 1; }
  ft_take_in "$r" ff || rc=$?
  [ "$rc" = 2 ] && FT_WHY="GitHub's newer commits change files this clone has changed or holds untracked: $FT_CONFLICTS"
  [ "$rc" = 0 ]
}

# ft_push_main <repo>: push HEAD to origin's main. If GitHub has newer commits, rebase once onto them and
# push again (uncommitted changes are set aside for the rebase and put back after it). Returns
#   0  pushed;
#   2  GitHub's newer commits change the same lines as this clone's commits or its uncommitted changes, or
#      add untracked files it has with other contents: everything is put back as it was, nothing is pushed,
#      and FT_CONFLICTS names the files;
#   1  anything else (GitHub out of reach, say): nothing is pushed.
# Never use it for the site repo: a payload commit carries the whole payload, so it is never rebased.
ft_push_main() {
  local r="$1" i out rc=0
  FT_CONFLICTS=""
  for i in 1 2 3; do
    out="$(git -C "$r" push -q origin HEAD:main 2>&1)" && return 0
    case "$out" in *rejected*|*"fetch first"*|*non-fast-forward*) break ;; esac   # newer commits: rebase now
    sleep $((2 ** i))
  done
  git -C "$r" fetch -q origin main 2>/dev/null || return 1
  ft_take_in "$r" rebase || rc=$?
  [ "$rc" = 0 ] || return "$rc"
  for i in 1 2 3; do
    git -C "$r" push -q origin HEAD:main 2>/dev/null && return 0
    sleep $((2 ** i))
  done
  return 1
}

# ft_lock_on_github <repo>: the writer lock as GitHub has it (origin/main:ledger/LOCK, fetched by the caller):
# prints "free", or "<who>|<since>|<age in hours>".
ft_lock_on_github() {
  git -C "$1" show origin/main:ledger/LOCK 2>/dev/null | python3 -I -c 'import json,sys,datetime
raw=sys.stdin.read().strip()
try: d=json.loads(raw)
except Exception: d=None
if not isinstance(d,dict) or not d.get("who"): print("free"); sys.exit()
try: age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(d["since"].replace("Z","+00:00"))).total_seconds()/3600
except Exception: age=99
print("%s|%s|%.1f" % (d["who"], d.get("since",""), age))'
}

# ft_msg_problem <repo> <sha>: the airlock's message rules (family-tree-airlock's rules.py) on the message as
# it is stored in the commit: exactly one line, at most 72 characters, no capitalised word after the first
# (split into words as tools/check-commit-msg.js splits them). Prints the problem and returns 0; returns 1 when
# the message is fine. (The names in the message are tools/check-commit-msg.js's to check.)
ft_msg_problem() {
  local m
  m="$(git -C "$1" log -1 --format=%B "$2" 2>/dev/null)" || { echo "its message cannot be read"; return 0; }
  printf '%s' "$m" | python3 -I -c 'import re,sys
TECH={"github","actions","pages","readme","json","html","css","aes","gcm","ci","en","fr","node","npm","js","url","urls",
      "pbkdf2","svg","jpeg","png","dom","api","http","https","utf","claude","cowork","windows","linux"}
def problem(text):
    lines=[l.rstrip() for l in text.split("\n")]
    while lines and not lines[-1]: lines.pop()
    if len(lines)!=1 or not lines[0]: return "its message is not one line (no body, no trailers)"
    s=lines[0]
    if len(s)>72: return "its message is %d characters (the limit is 72)" % len(s)
    for w in [w for w in re.split(r"(?:[^\w\x27-]|_)+", s) if w][1:]:
        b=re.sub(r"[\x27-].*$","",w)
        if len(b)<2 or b.lower() in TECH or b==b.upper(): continue
        if b[0].isupper(): return "its message has a capitalised word after the first"
    return None
try: p=problem(sys.stdin.read())
except Exception: p="its message could not be checked"
if p: print(p); sys.exit(0)
sys.exit(1)'
}

# ft_newest <site clone>: the newest site commit, published or queued: the queue when it sits on public
# main, else public main (refs fetched by the caller).
ft_newest() {
  if git -C "$1" rev-parse -q --verify refs/remotes/queue/site-queue >/dev/null \
     && git -C "$1" merge-base --is-ancestor origin/main refs/remotes/queue/site-queue; then
    git -C "$1" rev-parse refs/remotes/queue/site-queue
  else
    git -C "$1" rev-parse origin/main
  fi
}

# ft_conflict <site clone>: true when the queue and public main are out of line (neither holds the other):
# a QUEUE CONFLICT (refs fetched by the caller).
ft_conflict() {
  local q; q="$(git -C "$1" rev-parse -q --verify refs/remotes/queue/site-queue 2>/dev/null)" || return 1
  git -C "$1" merge-base --is-ancestor "$q" origin/main && return 1
  git -C "$1" merge-base --is-ancestor origin/main "$q" && return 1
  return 0
}

# ft_ready: cloud-setup.sh finished in this session (it removes the mark when it starts, writes it last).
ft_ready() { [ -f "$HOME/.ft-ready" ]; }
