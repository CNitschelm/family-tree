# cloud-lib.sh — functions shared by cloud-setup.sh, cloud-lock.sh and cloud-finish.sh. Sourced, never run.

# ft_status_json <family-tree-private url>: the airlock's latest status.json, as it is (family-tree-private's
# branch airlock-status). Returns 0 and prints it; 1 when there is no verdict yet; 2 when it cannot be read
# (GitHub out of reach, an empty file).
ft_status_json() {
  local url="$1" t st="" lr=0
  git ls-remote --exit-code "$url" refs/heads/airlock-status >/dev/null 2>&1 || lr=$?
  [ "$lr" = 2 ] && return 1
  [ "$lr" = 0 ] || return 2
  t="$(mktemp -d)"; git init -q "$t"
  if git -C "$t" fetch -q --depth 1 "$url" refs/heads/airlock-status 2>/dev/null; then
    st="$(git -C "$t" show FETCH_HEAD:status.json 2>/dev/null || true)"
  fi
  rm -rf "$t"
  [ -n "$st" ] || return 2
  printf '%s\n' "$st"
}

# ft_verdict <family-tree-private url>: the airlock's latest verdict (family-tree-private's branch airlock-status).
# Prints "<result> <queue head> <rule>" (the rule's spaces as _) and returns 0; returns 1 when there is no
# verdict yet; 2 when it cannot be read (GitHub out of reach, a broken file): callers stop, never pass.
ft_verdict() {
  local st src=0 out
  st="$(ft_status_json "$1")" || src=$?
  [ "$src" = 0 ] || return "$src"
  out="$(printf '%s' "$st" | python3 -I -c 'import json,sys
try: d=json.load(sys.stdin)
except Exception: d=None
if not isinstance(d, dict): print("? - -")
else: print(d.get("result") or "-", d.get("queue_head") or "-", (d.get("rule") or "-").replace(" ", "_"))')"
  [ "${out%% *}" = "?" ] && return 2
  echo "$out"
}

# ft_last_check <family-tree-private url>: when the airlock last recorded a check, and its result, for a
# message: "<time> (<result>)". It records one only when the queue held something, so a quiet airlock and a
# stopped one look alike here. Prints "none recorded yet" or "could not be read" otherwise; always returns 0.
ft_last_check() {
  local st src=0
  st="$(ft_status_json "$1")" || src=$?
  [ "$src" = 1 ] && { echo "none recorded yet"; return 0; }
  [ "$src" = 0 ] || { echo "could not be read"; return 0; }
  printf '%s' "$st" | python3 -I -c 'import json,re,sys
try: d=json.load(sys.stdin)
except Exception: d=None
if not isinstance(d, dict): print("could not be read")
else: print("%s (%s)" % (re.sub(r"[^0-9TZ:+.-]", "", str(d.get("at") or "")) or "at an unrecorded time", re.sub(r"[^a-z_-]", "", str(d.get("result") or "")) or "no result"))' 2>/dev/null \
    || echo "could not be read"
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

# ft_push_kind <what git printed when a push failed>: what kind of failure it was (16 Nov 2026: every failure
# but a same-lines conflict used to be reported as "GitHub out of reach? run this again", git's own words thrown
# away, so a file over the size limit or a session without push access looked like a network fault). Prints
#   moved        rejected because the remote has newer commits (or two pushes met at the same moment)
#   large        refused by the server: a file over its size limit
#   protected    refused by the server: a protected branch, or a repository rule
#   denied       refused by the server: this session may not push there (no access, a sign-in not accepted)
#   refused      refused by the server otherwise: a hook on its side declined the push
#   unreachable  anything else: the server was not reached, or failed on its side. That includes a
#                "[remote rejected]" the server gives for a fault of its own ("Internal Server Error",
#                "failure", "unpacker error": GitHub's incidents read like that), which passes: tried again.
# The server's refusals are looked for first: "[remote rejected]" holds the word "rejected" too.
ft_push_kind() {
  local o; o="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$o" in
    *"cannot lock ref"*|*"failed to lock"*|*"failed to update ref"*) echo moved ;;
    *gh001*|*"large files detected"*|*"file size limit"*|*"http 413"*|*"error: 413"*) echo large ;;
    *gh006*|*"protected branch"*|*gh013*|*"repository rule violations"*) echo protected ;;
    *"permission to "*" denied"*|*"permission denied"*|*"authentication failed"*|*"could not read username"*|\
    *"could not read password"*|*"invalid username or password"*|*"repository not found"*|*"repository '"*"' not found"*|\
    *"error: 401"*|*"error: 403"*|*"error: 404"*|*"http 401"*|*"http 403"*|*"http 404"*|*"http code 403"*) echo denied ;;
    *"hook declined"*|*"pre-receive"*) echo refused ;;
    *"[rejected]"*|*"fetch first"*|*non-fast-forward*) echo moved ;;
    *) echo unreachable ;;
  esac
}

# ft_push_failed <kind> <what git printed> <repo>: record a failed push for the caller's message.
#   FT_PUSH_KIND  the kind (as ft_push_kind names it, or "rebase": GitHub's newer commits could not be taken in)
#   FT_PUSH_WHY   what it means and what to do next, in a sentence or two
#   FT_PUSH_SAID  git's own last lines, indented (a sign-in inside an address is cut out: never print a secret)
ft_push_failed() {
  local name; name="$(basename "$3")"
  FT_PUSH_KIND="$1"
  FT_PUSH_SAID="$(printf '%s\n' "$2" | sed -E 's#(https?://)[^/@[:space:]]*@#\1#g; s/[[:space:]]+$//' | grep -v -e '^$' -e '^hint:' \
    | tail -n 8 | cut -c1-300 | sed 's/^/    /')"
  [ -n "$FT_PUSH_SAID" ] || FT_PUSH_SAID="    (git printed nothing)"
  case "$1" in
    large) FT_PUSH_WHY="GitHub refused it: a file in these commits is over its size limit (100 MB). Running this again
  changes nothing: take the file out of the unpushed commits of $name (git -C \"$3\" log --stat origin/main..HEAD
  shows them; git -C \"$3\" reset --soft origin/main undoes them and keeps the files), then run this again." ;;
    protected) FT_PUSH_WHY="GitHub refused it: main of $name is protected, or a repository rule refuses these commits.
  Running this again changes nothing, and only Cory can change the rule: stop, and tell him what git said." ;;
    denied) FT_PUSH_WHY="GitHub refused it: this session may not push to $name (no push access, or its sign-in was not
  accepted). Running this again changes nothing: $name must be attached to this session with push access (Cory
  adds it, or starts a session that has it); then run this again." ;;
    refused) FT_PUSH_WHY="GitHub's side declined the push of $name: a hook or check there refused these commits (git's
  lines below say why). Running this again changes nothing while that holds: stop, and say so in this session's
  report, with git's lines. (If they show a failure on GitHub's own side instead, run this again in a few minutes.)" ;;
    moved) FT_PUSH_WHY="GitHub's main of $name kept moving while this was pushed (another session is pushing too):
  run this again." ;;
    rebase) FT_PUSH_WHY="GitHub has newer commits of $name, and this clone's commits could not be put on top of them.
  Look at both sides (git -C \"$3\" status; git -C \"$3\" log --oneline HEAD...origin/main), then run this again." ;;
    *) FT_PUSH_WHY="GitHub could not be reached, or failed on its side: run this again in a few minutes. If it fails
  the same way again, git's lines below are the reason." ;;
  esac
}

# ft_push_report: the text a caller puts after "<what> could not be pushed. " (FT_PUSH_WHY, then git's lines).
ft_push_report() { printf '%s\n  git said:\n%s' "$FT_PUSH_WHY" "$FT_PUSH_SAID"; }

# ft_push_main <repo>: push HEAD to origin's main. If GitHub has newer commits, rebase once onto them and
# push again (uncommitted changes are set aside for the rebase and put back after it). Returns
#   0  pushed;
#   2  GitHub's newer commits change the same lines as this clone's commits or its uncommitted changes, or
#      add untracked files it has with other contents: everything is put back as it was, nothing is pushed,
#      and FT_CONFLICTS names the files;
#   3  the server refused the push (a file too large, a protected branch, no push access, a hook that
#      declined): nothing is pushed, and it is not tried again, since trying again changes nothing;
#   1  anything else (GitHub out of reach, or a fault on its side), after the retries: nothing is pushed.
# For 1 and 3, FT_PUSH_KIND, FT_PUSH_WHY and FT_PUSH_SAID say what happened, in git's own words too
# (ft_push_report puts them together). FT_RETRY_WAIT=0 (tests) takes the waits between tries away.
# Never use it for the site repo: a payload commit carries the whole payload, so it is never rebased.
ft_push_main() {
  local r="$1" i out="" kind="" rc=0 w="${FT_RETRY_WAIT:-1}"
  FT_CONFLICTS=""; FT_PUSH_KIND=""; FT_PUSH_WHY=""; FT_PUSH_SAID=""
  for i in 1 2 3; do
    out="$(git -C "$r" push -q origin HEAD:main 2>&1)" && return 0
    kind="$(ft_push_kind "$out")"
    case "$kind" in
      moved) break ;;                                    # newer commits: rebase now
      unreachable) ;;                                    # try again
      *) ft_push_failed "$kind" "$out" "$r"; return 3 ;;
    esac
    sleep $(( w * 2**i ))
  done
  if ! out="$(git -C "$r" fetch -q origin main 2>&1)"; then ft_push_failed unreachable "$out" "$r"; return 1; fi
  ft_take_in "$r" rebase || rc=$?
  if [ "$rc" = 1 ]; then ft_push_failed rebase "$FT_WHY" "$r"; fi
  [ "$rc" = 0 ] || return "$rc"
  for i in 1 2 3; do
    out="$(git -C "$r" push -q origin HEAD:main 2>&1)" && return 0
    kind="$(ft_push_kind "$out")"
    case "$kind" in moved|unreachable) ;; *) ft_push_failed "$kind" "$out" "$r"; return 3 ;; esac
    sleep $(( w * 2**i ))
  done
  ft_push_failed "$kind" "$out" "$r"; return 1
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

# ft_queue_wait <site clone> <private clone>: how long the queue's unpublished commits have waited, from the refs
# as they were last fetched (it reads nothing from GitHub, so tools/doctor.js can ask too). Prints
# "<hours, one decimal> <commits waiting> <queued|committed>" and returns 0; returns 1 when nothing waits, or
# when the queue is out of line with public main (a QUEUE CONFLICT has its own stop).
#   queued     the hours since the finish that put the OLDEST waiting commit into the queue: a finish writes
#              the head it is about to queue into family-tree-private's .public-head seconds before it queues,
#              so that file's history has the time;
#   committed  that history does not reach back that far here (a shallow clone), so the hours since the oldest
#              waiting commit was MADE: as long or longer, because a commit can sit on its machine before it
#              is queued.
# The airlock runs every two hours; ft_queue_late says when a wait means it has missed a run.
ft_queue_wait() {
  local ft="$1" priv="$2" q m n c0 t0 how=committed c ct v prev=""
  q="$(git -C "$ft" rev-parse -q --verify refs/remotes/queue/site-queue 2>/dev/null)" || return 1
  m="$(git -C "$ft" rev-parse -q --verify refs/remotes/origin/main 2>/dev/null)" || return 1
  git -C "$ft" merge-base --is-ancestor "$m" "$q" 2>/dev/null || return 1
  n="$(git -C "$ft" rev-list --count "$m..$q" 2>/dev/null)" || return 1
  [ "$n" -gt 0 ] || return 1
  c0="$(git -C "$ft" rev-list --reverse "$m..$q" | head -n 1)"
  t0="$(git -C "$ft" log -1 --format=%ct "$c0" 2>/dev/null)" || return 1
  # newest first: the state commits whose .public-head holds c0; the first one that does not proves the one
  # after it is the finish that queued c0. Run out of history first, and nothing is proved.
  while read -r c ct; do
    v="$(git -C "$priv" show "$c:.public-head" 2>/dev/null | tr -d '\r\n')"
    if [ -n "$v" ] && git -C "$ft" merge-base --is-ancestor "$c0" "$v" 2>/dev/null; then prev="$ct"
    else
      if [ -n "$prev" ]; then t0="$prev"; how=queued; fi
      break
    fi
  done < <(git -C "$priv" log --format='%H %ct' origin/main -- .public-head 2>/dev/null)
  python3 -I -c 'import sys,time; print("%.1f %s %s" % (max(0.0, time.time() - int(sys.argv[1])) / 3600, sys.argv[2], sys.argv[3]))' "$t0" "$n" "$how"
}

# ft_queue_late <hours>: true when a wait of that many hours says the airlock has missed a run: more than 4
# (it runs every 2).
ft_queue_late() { python3 -I -c 'import sys; sys.exit(0 if float(sys.argv[1]) > 4 else 1)' "${1:-0}" 2>/dev/null; }

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

# ft_linkconf_sync <site clone>: keep the % on each parent-child line current (Cory, 9 Nov 2026). Runs
# tools/linkconf.js sync, which does nothing when neither the ledger (ledger/link-confidence.json) nor the
# tree's links changed since the last build (owner.bin gets a random iv at every build, so it is never
# rebuilt for nothing); otherwise it retires the links gone from the tree, rates the new ones from their
# cards' sources and builds. What it rebuilt (media/owner.bin, media/links.bin, stats.json) is committed here,
# one neutral line; the ledger goes with the private state. Call it only on a clean site tree. Returns
#   0  current, or rebuilt and committed; also when there is no .owner-key (a NOTE: never make a new key)
#   1  lines with no figure: FT_LINKCONF_MSG is "<n> lines have no figure: <ids>"
#   2  sync failed otherwise, or the commit failed (FT_LINKCONF_MSG says what)
ft_linkconf_sync() {
  local ft="$1" out rc=0 files="media/owner.bin media/links.bin stats.json"
  FT_LINKCONF_MSG=""
  if [ ! -s "$ft/.owner-key" ]; then
    echo "NOTE: no .owner-key (FT_OWNER_KEY): the line figures were not checked (linkconf.js never makes a new owner key)"
    return 0
  fi
  out="$(cd "$ft" && node tools/linkconf.js sync 2>&1)" || rc=$?
  printf '%s\n' "$out" | sed 's/^/  /'
  if [ "$rc" = 1 ] && FT_LINKCONF_MSG="$(printf '%s\n' "$out" | grep -m 1 -E '^[0-9]+ lines? ha(s|ve) no figure: ')"; then
    return 1
  elif [ "$rc" != 0 ]; then
    FT_LINKCONF_MSG="tools/linkconf.js sync failed (exit $rc): $(printf '%s\n' "$out" | grep -v '^$' | tail -n 1)"
    return 2
  fi
  # shellcheck disable=SC2086
  [ -z "$(git -C "$ft" status --porcelain -- $files)" ] && return 0
  # shellcheck disable=SC2086
  { git -C "$ft" add -- $files && git -C "$ft" commit -q -m "Update link figures" -- $files; } \
    || { FT_LINKCONF_MSG="the rebuilt line figures could not be committed"; return 2; }
  echo "linkconf: committed the new line figures ($(git -C "$ft" rev-parse --short HEAD))"
}
