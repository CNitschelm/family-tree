#!/usr/bin/env bash
# cloud-selftest.sh — rehearse the cloud loop on throwaway copies, with local "GitHub" remotes.
# Touches nothing real: every repo here is a temporary copy, every remote is a local folder, and setup's
# fixed search folder (FT_ATTACH_DIR, /home/user in a real session) is an empty folder of its own. Its last
# check proves it: the real clones on this machine and the real HOME's files are as they were.
#
#   bash tools/cloud-selftest.sh <a clone of CNitschelm/family-tree to copy the site's files from>
#
# Covers: setup on a shallow clone (full history, hook, links at the top level and inside a public
# folder, all ignored, idempotent, the private repo's own files not linked), setup's refusals,
# verify's file and link checks, the shared lock (a refused race, a renewal, a takeover with --steal, a
# release refused when the lock changed on GitHub, no lock before setup has finished or in the middle of a
# rebase, a take that looks at the queue again once it holds the lock), finish (state first, then the site
# into the queue, .public-head, lock released, a later session starts from the queue, a clone behind the
# queue pushes its state and leaves .public-head alone), the notes checkpoint, the source archive (no
# uncommitted copies, its commits pushed first), finish's stops (not set up, a rebase unfinished, a stray
# private file, a replaced link at the top level and inside a public folder, uncommitted site changes,
# files the airlock does not publish, a message with a body, an author or committer whose address may not be
# published (one written with capitals too) or whose name holds an @, a payload the gate did not pass, more commits
# than the airlock takes, no writer lock or someone else's, a commit a queue rebuild dropped, other site
# work under this session's commits, a private push that meets the same lines: undone), the airlock's
# verdicts (refused blocks setup and the lock, a finish already under way still queues with a warning,
# published releases), direct publishing (only with an empty queue and the writer lock; live only when the site
# serves the commit's own page, not just its payload), a routine that
# clones the site itself or runs setup from inside its own clone, a QUEUE CONFLICT (setup and the lock
# stop), a read-only session (FT_READONLY=1) that neither stops on a blocked queue nor pushes, a finish that
# could not queue (exit 2: the same machine's setup then stops, and the printed command repairs it),
# setup's STATE SPLIT stop (after which the lock and finish refuse), and that nothing outside its folder changed.
# Since 16 Nov 2026 also: a failed push that says why (a file too large, no push access, a server not reached,
# each told from the rest, with git's own words), a finish that stops on a file of 95 MB before anything is
# committed or pushed, the note for files git ignores under _work/ and the archive's inbox, the wider notes
# checkpoint (notes/, the open items, the changelog and pending change files, never the state), the archive's
# source list rebuilt at the full finish (a note when it cannot be), the gate's stamp (line 2: a pass over
# origin/main or the queue's head), a lock release that fails after queuing (exit 4, said last), setup's stop
# when a private repository is not attached, and the queue that has waited (a warning at setup and in
# tools/doctor.js, which is run from the copy under test with FT_ROOT) with the note about the platform's
# "unpushed commits" message, and the airlock's heartbeat (a warning at setup and in tools/doctor.js when it
# is more than eight hours old, whatever the queue holds; none at seven; a note when it cannot be read or is
# dated ahead of now; the doctor's queue warning worded by it, as setup's is). From the review of that work: a fault on GitHub's own side is tried again, not
# taken for a refusal; a folder of ignored files is named once; a source list whose commit cannot be pushed, or
# that manifest.js calls incomplete (by its exit code), stops neither a finish nor a checkpoint and never reaches the
# archive; the checkpoint's two kinds of clash each get their own way out; and every setup that may write ends
# with the standing note about the platform's push reminder.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SEED="${1:?usage: cloud-selftest.sh <site clone>}"
T="$(mktemp -d /tmp/ft-selftest.XXXXXX)"
# the scripts under test run from a copy: from inside a site clone, cloud-setup.sh would use that clone
TOOLS="$T/tools-under-test"; mkdir -p "$TOOLS"
cp "$HERE"/cloud-lib.sh "$HERE"/cloud-setup.sh "$HERE"/cloud-verify.sh "$HERE"/cloud-lock.sh "$HERE"/cloud-finish.sh "$HERE"/doctor.js "$TOOLS"/
export GIT_AUTHOR_NAME=selftest GIT_AUTHOR_EMAIL=selftest@example.invalid GIT_COMMITTER_NAME=selftest GIT_COMMITTER_EMAIL=selftest@example.invalid
unset FT_DIR FT_PRIVATE_DIR FT_ARCHIVE FT_RESEARCH FT_LEDGER FT_PASSWORD FT_OWNER_KEY FT_PUBLISH FT_READONLY FT_WHO
export FT_SPLIT_WAIT=1 FT_RETRY_WAIT=0
# where the platform attaches a real session's repositories (/home/user): setup searches it too, so in a real
# session a test of "no site attached" would find that session's own clones. Here it is an empty folder.
export FT_ATTACH_DIR="$T/attached"; mkdir -p "$FT_ATTACH_DIR"
real_state() { # one line per real clone near this machine and per HOME file: what the selftest must leave alone
  local d seen="" f
  for d in "$SEED" /home/user/family-tree /home/user/family-tree-private /home/user/family-tree-sources \
           "$HOME/family-tree" "$HOME/family-tree-private" "$HOME/family-tree-sources"; do
    [ -e "$d/.git" ] || continue
    d="$(cd -P "$d" && pwd)"; case " $seen " in *" $d "*) continue ;; esac; seen="$seen $d"
    printf '%s %s\n' "$d" "$( { git -C "$d" symbolic-ref -q HEAD; git -C "$d" rev-parse -q --verify HEAD
      git -C "$d" for-each-ref --format='%(refname) %(objectname)'; git -C "$d" config --local --list
      git -C "$d" status --porcelain=v1 -uall; } 2>&1 | sha256sum | cut -c1-16)"
  done
  for f in .ft-env .ft-ready .bashrc .profile; do printf '%s %s\n' "$HOME/$f" "$(if [ -f "$HOME/$f" ]; then cksum < "$HOME/$f"; else echo absent; fi)"; done
}
REAL_BEFORE="$(real_state)"
pass=0; failn=0
ok()   { printf '  ok    %s\n' "$*"; pass=$((pass+1)); }
no()   { printf '  FAIL  %s\n' "$*"; failn=$((failn+1)); }
check(){ local what="$1"; shift; if "$@" >"$T/last.out" 2>&1; then ok "$what"; else no "$what"; sed 's/^/          /' "$T/last.out" | tail -8; fi; }
refuse(){ local what="$1"; shift; if "$@" >"$T/last.out" 2>&1; then no "$what (it did not stop)"; sed 's/^/          /' "$T/last.out" | tail -4; else ok "$what"; fi; }
says() { if grep -q "$1" "$T/last.out"; then ok "$2"; else no "$2"; sed 's/^/          /' "$T/last.out" | tail -6; fi; }
# lacks: the last output does NOT hold $1. (Not "refuse grep … last.out": refuse writes the command's output to
# last.out, so that grep would read a file just emptied, and the check would pass whatever was said.)
lacks(){ if grep -q "$1" "$T/last.out"; then no "$2"; grep "$1" "$T/last.out" | head -n 3 | sed 's/^/          /'; else ok "$2"; fi; }
quiet(){ "$@" >/dev/null 2>&1; }
gnohook(){ git -c core.hooksPath=/dev/null -c commit.gpgsign=false "$@"; }
GH="$T/gh"; GHP="$GH/family-tree-private.git"; GHS="$GH/family-tree.git"; GHA="$GH/family-tree-sources.git"
gp() { git --git-dir="$GHP" "$@"; }        # the private repo as GitHub has it
mc() { # $1 = session, $2 = name: a site commit the airlock publishes (a new media file)
  head -c 64 /dev/urandom > "$T/$1/family-tree/media/$2.bin" && git -C "$T/$1/family-tree" add "media/$2.bin" \
    && gnohook -C "$T/$1/family-tree" commit -qm "Update site media $2"
}
pc() { # $1 = session, $2 = 16 characters: a payload commit (only the payload line of index.html changes), gate passed
  sed -i -E 's/(const ENC = \{v:[0-9]+, iter:[0-9]+, salt:"[^"]*", iv:")[A-Za-z0-9+\/]{16}"/\1'"$2"'"/' "$T/$1/family-tree/index.html" \
    && gnohook -C "$T/$1/family-tree" commit -qam "Update site data payload" && gstamp "$T/$1/family-tree" "$2"
}
gstamp() { # $1 = site clone, $2 = iv, $3 = base (default origin/main): .gate-stamp as checks/gate.js writes it on a pass
  printf '%s\n%s PASS 1 change set(s) 1 edit(s) over %s\n' "$2" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "${3:-origin/main}" > "$1/.gate-stamp"
}
fin() { local n="$1"; shift; in_cloud "$n" env FT_SKIP_LIVE=1 bash "$TOOLS/cloud-finish.sh" "$@"; }
side() { # $1 = name: a commit pushed to public main by hand, past the tools and the lock
  rm -rf "$T/side" && git clone -q "file://$GHS" "$T/side" && echo "<!-- $1 -->" > "$T/side/$1.txt" \
    && git -C "$T/side" add -f "$1.txt" && gnohook -C "$T/side" commit -qm "Add a side file" && git -C "$T/side" push -q origin HEAD:main
}
echo "selftest in $T"

# ------------------------------------------------------------------ fake GitHub
mkdir -p "$T/seed-site" && git -C "$SEED" archive HEAD | tar -x -C "$T/seed-site"
( cd "$T/seed-site" && git init -q -b main && git add -A -f && gnohook commit -qm "Add the site" \
  && echo "<!-- 2 -->" >> README.md && gnohook commit -qam "Update the readme" )
quiet git clone --bare "$T/seed-site" "$GHS"
# (the archive ignores its inbox, as the real one does: captures wait there to be filed)
mkdir -p "$T/seed-src/archive/inbox" && ( cd "$T/seed-src" && git init -q -b main && echo "# index" > archive/INDEX.md \
  && : > archive/inbox/.gitkeep && printf 'archive/inbox/*\n!archive/inbox/.gitkeep\n' > .gitignore && git add -A && gnohook commit -qm init )
quiet git clone --bare "$T/seed-src" "$GHA"
# the private repo as refresh.py builds it: its own files, the entries, .private-paths, MANIFEST.sha256
# (checks/source-hosts.json is checks/manifest.js's private list of hosts: without it that script's list is
# not complete, and the finish keeps such a list out of the archive; here it lists no host)
P0="$T/seed-priv"; mkdir -p "$P0"/ledger/history "$P0"/notes "$P0"/working/i18-plan "$P0"/sources "$P0"/evidence "$P0"/_work/go1 "$P0"/checks
( cd "$P0" && printf '{"investigations":[],"updated":"2026-10-17"}\n' > research.json && printf 'free\n' > ledger/LOCK \
  && : > ledger/changes.jsonl && : > ledger/register.jsonl && printf 'gz' > ledger/history/abc.json.gz \
  && echo note > notes/memory.md && echo 'print(1)' > working/i18-plan/a.py && echo '# open' > OPEN-ITEMS.md \
  && echo '# log' > CHANGE-LOG-COMMITS.md && echo '{}' > history.json && echo '[]' > checks/priority-cards.json \
  && echo '{"risk":{},"kind":{}}' > checks/source-hosts.json \
  && echo '# notes' > _work/go1/NOTES.md && echo e > evidence/crop.txt && echo s > sources/urls.tsv \
  && echo '# private readme' > README.md && echo 'print("refresh")' > refresh.py && printf '* -text\n' > .gitattributes \
  && printf '.password\n/data.json\n/_work/**/*.png\n/_work/**/*.tgz\n' > .gitignore \
  && printf '%s\n' CHANGE-LOG-COMMITS.md OPEN-ITEMS.md _work checks/priority-cards.json checks/source-hosts.json evidence history.json ledger notes research.json sources working > .private-paths \
  && find . -type f ! -path './.git/*' ! -name README.md ! -name refresh.py ! -name .gitattributes ! -name .gitignore ! -name .private-paths ! -name MANIFEST.sha256 \
       | sed 's#^\./##' | sort | xargs sha256sum > MANIFEST.sha256 \
  && git init -q -b main && git add -A && gnohook commit -qm "Add the private working files" )
quiet git clone --bare "$P0" "$GHP"
# a switch that makes "GitHub" refuse queue pushes (for the exit 2 case)
cat > "$GHP/hooks/pre-receive" <<EOF
#!/bin/sh
[ -e "$T/queue-closed" ] || exit 0
while read o n r; do [ "\$r" = refs/heads/site-queue ] && { echo "the queue is closed for this test" >&2; exit 1; }; done
exit 0
EOF
chmod +x "$GHP/hooks/pre-receive"

cloud() { # $1 = name; setup for a cloud session in $T/$1 (shallow clones, as the platform makes them)
  mkdir -p "$T/$1/home"
  [ -d "$T/$1/family-tree" ] || quiet git clone --depth 1 "file://$GHS" "$T/$1/family-tree"
  [ -d "$T/$1/family-tree-private" ] || quiet git clone --depth 1 "file://$GHP" "$T/$1/family-tree-private"
  [ -d "$T/$1/family-tree-sources" ] || quiet git clone --depth 1 "file://$GHA" "$T/$1/family-tree-sources"
  local r; for r in family-tree family-tree-private family-tree-sources; do   # like the platform: a session branch, no upstream
    [ "$(git -C "$T/$1/$r" symbolic-ref -q --short HEAD)" = main ] && [ ! -e "$T/$1/.started" ] && git -C "$T/$1/$r" checkout -q -b claude/session-test
  done; : > "$T/$1/.started"
  # the decrypted working copy, made up: the commit guard reads its names
  [ -e "$T/$1/family-tree/data.json" ] || printf '{"tree":{"id":"c001","name":"Selftest Person","unions":[]}}\n' > "$T/$1/family-tree/data.json"
  ( cd "$T/$1" && HOME="$T/$1/home" FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash "$TOOLS/cloud-setup.sh" )
}
in_cloud() { local n="$1"; shift; HOME="$T/$n/home" "$@"; }
lock() { local n="$1"; shift; in_cloud "$n" bash "$TOOLS/cloud-lock.sh" "$@"; }
work() { # $1 = session: the lock, one site commit and one private edit, then finish
  lock "$1" take "$1" "work" >/dev/null && mc "$1" "w-$(echo "$1" | tr 'A-Z' 'a-z')" \
    && echo "$1" >> "$T/$1/family-tree-private/OPEN-ITEMS.md" && fin "$1" "Update working state" "$1"
}

echo "1. setup"
check "setup finds the clones by itself and runs on shallow clones that start on a session branch" cloud A
tail -n 6 "$T/last.out" | grep -q "the platform may ask to push commits on branch 'main'" && grep -q "never run git push in the site clone" "$T/last.out" \
  && ok "…and ends with the standing note: the platform may ask to push commits on main, and never to (the queue is empty here)" || no "setup's standing note about the platform"
A="$T/A/family-tree"; PA="$T/A/family-tree-private"; AA="$T/A/family-tree-sources"
check "the clones did start on a session branch (as the platform makes them)" git -C "$PA" show-ref --verify -q refs/heads/claude/session-test
check "…and puts all three on main, following origin/main" sh -c "for r in family-tree family-tree-private family-tree-sources; do test \"\$(git -C '$T/A/'\$r rev-parse --abbrev-ref HEAD)\" = main && git -C '$T/A/'\$r rev-parse -q --verify '@{upstream}' >/dev/null || exit 1; done"
check "the site clone now has its full history" test "$(git -C "$A" rev-parse --is-shallow-repository)" = false
check "the commit hook is on" test "$(git -C "$A" config core.hooksPath)" = githooks
check "research.json is a link into family-tree-private" test -L "$A/research.json" -a -e "$A/research.json"
check "ledger is a link" test -L "$A/ledger"
check "checks/priority-cards.json is a link inside the public checks folder" test -L "$A/checks/priority-cards.json" -a -e "$A/checks/priority-cards.json"
check "…and reads the private file" grep -q '\[\]' "$A/checks/priority-cards.json"
check "the site's own README.md is not shadowed by the private one" sh -c "! test -L '$A/README.md' && ! grep -q 'private readme' '$A/README.md'"
check "refresh.py and MANIFEST.sha256 are not linked" sh -c "! test -e '$A/refresh.py' && ! test -e '$A/MANIFEST.sha256'"
check "the public repo sees nothing new" test -z "$(git -C "$A" status --porcelain)"
check "the public repo ignores the nested link" git -C "$A" check-ignore -q --no-index checks/priority-cards.json
check "~/.ft-env points FT_RESEARCH into the private repo" grep -q "FT_RESEARCH=\"$PA/research.json\"" "$T/A/home/.ft-env"
check "setup marks the session ready when it finishes" test -s "$T/A/home/.ft-ready"
check "setup is idempotent (second run)" cloud A
check "a second session sets up independently" cloud B
B="$T/B/family-tree"; PB="$T/B/family-tree-private"

echo "2. setup refuses"
mk() { # $1 = name, $2 = the .private-paths line to add; a fresh session with a bad private repo
  rm -rf "$T/$1"; mkdir -p "$T/$1"
  quiet git clone --depth 1 "file://$GHS" "$T/$1/family-tree"
  quiet git clone "file://$GHP" "$T/$1/family-tree-private"
  quiet git clone --depth 1 "file://$GHA" "$T/$1/family-tree-sources"
  printf '%s\n' "$2" >> "$T/$1/family-tree-private/.private-paths"
}
for bad in README.md tools tools/x.js '../outside' '/etc/hosts' .git 'no-such-entry'; do
  mk R "$bad"
  case "$bad" in tools|tools/x.js) mkdir -p "$T/R/family-tree-private/tools" && echo x > "$T/R/family-tree-private/tools/x.js" ;; esac
  refuse "setup refuses the entry '$bad'" sh -c "cd '$T/R' && HOME='$T/R' FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
  printf '          (%s)\n' "$(grep -m1 'SETUP STOPPED' "$T/last.out" | cut -c16-120)"
  [ -z "$(git -C "$T/R/family-tree" status --porcelain)" ] || no "…but it left a stray file in the site clone"
  [ ! -e "$T/R/.ft-ready" ] || no "…but it marked the session ready"
done
mk S ""; echo x > "$T/S/family-tree/OPEN-ITEMS.md"
refuse "setup refuses to shadow a real file with a link" sh -c "cd '$T/S' && HOME='$T/S' FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
says 'real file' "…and says why"

echo "3. verify (files and links)"
check "verify passes its file and link checks" in_cloud A env FT_VERIFY_SKIP_TOOLS=1 bash "$TOOLS/cloud-verify.sh"
echo tampered >> "$PA/notes/memory.md"
refuse "verify fails when a file differs from MANIFEST.sha256" in_cloud A env FT_VERIFY_SKIP_TOOLS=1 bash "$TOOLS/cloud-verify.sh"
git -C "$PA" checkout -q -- notes/memory.md

echo "4. the shared lock"
check "session A takes the lock" lock A take "session-a" "test"
check "…and FT_WHO names the holder in ~/.ft-env" grep -qx 'export FT_WHO=session-a' "$T/A/home/.ft-env"
s1="$(gp show main:ledger/LOCK)"
check "taking it again under the same name renews it" lock A take "session-a" "test"
says "lock taken by" "…and says it was taken (a renewal is a take)"
test "$(gp show main:ledger/LOCK)" != "$s1" && ok "…with a new time on GitHub" || no "renewal did not change the lock"
refuse "session B is refused while A holds it" lock B take "session-b" "test"
lock A release "session-a" >/dev/null 2>&1
quiet git -C "$PB" pull -q --ff-only
check "session A takes it again" lock A take "session-a" "again"
( cd "$B" && HOME="$T/B/home" FT_LEDGER="$PB/ledger" node tools/lock.js take session-b race >/dev/null 2>&1 )
gnohook -C "$PB" commit -qam "race" >/dev/null 2>&1
refuse "B's stale lock push is refused by GitHub" git -C "$PB" push -q origin HEAD:main
quiet git -C "$PB" reset -q --hard origin/main
check "A releases" lock A release "session-a"
refuse "…and FT_WHO is gone from ~/.ft-env" grep -q '^export FT_WHO=' "$T/A/home/.ft-env"
check "releasing a free lock is fine" lock A release "session-a"
says "already free" "…and says so"
mv "$T/A/home/.ft-ready" "$T/A/home/.ft-ready.off"
refuse "the lock is refused until setup has finished in the session" lock A take "session-a" "test"
says "has not finished" "…and says why"
mv "$T/A/home/.ft-ready.off" "$T/A/home/.ft-ready"
mkdir "$(git -C "$PA" rev-parse --absolute-git-dir)/rebase-merge"
refuse "the lock is refused while a rebase is unfinished" lock A take "session-a" "test"
rmdir "$(git -C "$PA" rev-parse --absolute-git-dir)/rebase-merge"
quiet lock A take "session-a" "steal test"
quiet git -C "$PB" pull -q --ff-only
refuse "another session cannot take a live lock" lock B take "session-b" "steal"
check "…but can take it over with --steal (the holder is gone)" lock B take "session-b" "steal" --steal
refuse "a release is refused when someone else took the lock over on GitHub" lock A release "session-a"
says "changed on GitHub meanwhile" "…and says why, releasing nothing"
gp show main:ledger/LOCK | grep -q session-b && ok "…GitHub still shows the new holder" || no "steal survived"
test -z "$(git -C "$PA" status --porcelain)" && ! git -C "$PA" rev-parse -q --verify REBASE_HEAD >/dev/null && ok "…and A's clone is clean, no rebase left" || no "A after refused release"
check "B releases its lock" lock B release "session-b"
quiet git -C "$PA" pull -q --ff-only

echo "5. finish: state first, then the site into the queue"
PUB0="$(git --git-dir="$GHS" rev-parse main)"
quiet cloud M                                                          # set up before A queues anything
quiet lock A take "session-a" "edit"
echo "more" >> "$A/notes/memory.md"                                     # through a folder link
echo '["c1"]' > "$A/checks/priority-cards.json"                         # through the nested link
( . "$T/A/home/.ft-env"; printf '{"investigations":[],"updated":"2026-10-18"}\n' > "$FT_RESEARCH.new" && mv "$FT_RESEARCH.new" "$FT_RESEARCH" )  # like research.js save
echo "edit" >> "$PA/OPEN-ITEMS.md"                                     # at its real path
pc A AAAAAAAAAAAAAAA1
check "finish pushes the state, then queues the site (a payload-line commit the gate passed)" fin A "Update working state" "session-a"
check "…and does not touch public main (only the airlock publishes)" test "$(git --git-dir="$GHS" rev-parse main)" = "$PUB0"
check "the queue holds the site commit" test "$(gp rev-parse site-queue)" = "$(git -C "$A" rev-parse HEAD)"
check "…and the clone knows it (its queue ref is the queued head)" test "$(git -C "$A" rev-parse refs/remotes/queue/site-queue)" = "$(git -C "$A" rev-parse HEAD)"
check "GitHub's private main has the edits" sh -c "git --git-dir='$GHP' show main:OPEN-ITEMS.md | grep -q edit"
check "the nested file's edit reached the private repo" sh -c "git --git-dir='$GHP' show main:checks/priority-cards.json | grep -q c1"
check "research.json written through FT_RESEARCH reached the private repo" sh -c "git --git-dir='$GHP' show main:research.json | grep -q 2026-10-18"
check ".public-head is the queued site commit" test "$(gp show main:.public-head)" = "$(gp rev-parse site-queue)"
check "the lock was released, after the queue push" sh -c "git --git-dir='$GHP' show main:ledger/LOCK | grep -qx free"
check "…the state itself went up with the lock still held" sh -c "git --git-dir='$GHP' show main~1:ledger/LOCK | grep -q session-a"
ph="$(gp show main:.public-head)"
echo "m was here" > "$T/M/family-tree-private/notes/m.md"
check "a clone behind the queue pushes its state (on top of the newer private commits)" fin M "Update working state"
says "nothing new to publish" "…and publishes nothing"
test "$(gp show main:.public-head)" = "$ph" && gp show main:notes/m.md >/dev/null 2>&1 && ok "…leaving .public-head alone" || no "behind clone touched .public-head"
check "a later session picks it all up" cloud B
check "…and sees the edits through its links" sh -c "grep -q more '$B/notes/memory.md' && grep -q c1 '$B/checks/priority-cards.json'"
check "…and its main starts from the queue, not yet published" test "$(git -C "$B" rev-parse HEAD)" = "$(gp rev-parse site-queue)"
check "a session set up earlier catches up with the queue when it takes the lock" lock M take "session-m" "test"
check "…its main is now the queue's head" test "$(git -C "$T/M/family-tree" rev-parse HEAD)" = "$(gp rev-parse site-queue)"
quiet lock M release "session-m"
mc M m1
quiet lock A take "session-a" "more"
mc A a2
check "A queues one more commit" fin A "Update working state" "session-a"
refuse "a session with commits it never queued cannot take the lock once newer work is queued" lock M take "session-m" "test"
says "not queued" "…and says why"
quiet lock A take "session-a" "checks"
gnohook -C "$A" commit -q --allow-empty -m "update site media x" -m "# Somebody Named"
refuse "a commit whose stored message has a second line is refused (git keeps '#' lines given with -m)" fin A "Update working state" "session-a"
says "not one line" "…and says why, having pushed nothing"
git -C "$A" reset -q --hard HEAD~1
gnohook -C "$A" commit -q --allow-empty -m "update data for Somebody"
refuse "…and so is one with a capitalised word after the first" fin A "Update working state" "session-a"
git -C "$A" reset -q --hard HEAD~1
# the guard reads each queued commit's own author and committer, not the address of whoever runs the finish
q0="$(gp rev-parse site-queue)"
GIT_AUTHOR_EMAIL=someone@host.example gnohook -C "$A" commit -q --allow-empty -m "Update site media y"
refuse "a commit whose author has an address that may not be published is refused" fin A "Update working state" "session-a"
says "the author of this commit does not use an address that may be published" "…and says so, naming the author"
says "git config user.email" "…with the way to put it right"
says "git commit --amend --reset-author --no-edit" "…down to the guard's last step, the repair itself (once cut off after six lines)"
says "stop and report it to Cory" "…and what to do when the commit is older or already queued"
git -C "$A" reset -q --hard HEAD~1
GIT_COMMITTER_EMAIL=someone@host.example gnohook -C "$A" commit -q --allow-empty -m "Update site media y"
refuse "…and so is one whose committer has" fin A "Update working state" "session-a"
says "the committer of this commit does not use an address that may be published" "…naming the committer"
git -C "$A" reset -q --hard HEAD~1
# what the airlock refuses, the finish must refuse first: an address is compared as it is written, and a name
# that holds an @ is an address where a name belongs (both went into the queue until the review of 16 Nov 2026)
GIT_AUTHOR_EMAIL=Noreply@Anthropic.com gnohook -C "$A" commit -q --allow-empty -m "Update site media y"
refuse "…and so is one whose address is the sessions' own written with capitals (the airlock compares as written)" fin A "Update working state" "session-a"
says "compared as it is written" "…and says that capitals make it another address"
git -C "$A" reset -q --hard HEAD~1
GIT_COMMITTER_NAME=someone@host.example gnohook -C "$A" commit -q --allow-empty -m "Update site media y"
refuse "…and one whose committer's name holds an @ (the airlock refuses an address where a name belongs)" fin A "Update working state" "session-a"
says "the committer of this commit has a name that holds an @ sign" "…and says so, naming the committer"
says "git config user.name" "…with the way to put it right"
lacks "someone@" "…(the name itself is not printed)"
test "$(gp rev-parse site-queue)" = "$q0" && ok "…nothing was queued by any of the four" || no "a commit with an address or a name that may not be published was queued"
git -C "$A" reset -q --hard HEAD~1
pc A AAAAAAAAAAAAAAA2; gstamp "$A" AAAAAAAAAAAAAAA9
refuse "a payload the gate did not pass is refused" fin A "Update working state" "session-a"
says "not the one checks/gate.js last passed" "…and says why"
q0="$(gp rev-parse site-queue)"
echo "AAAAAAAAAAAAAAA2" > "$A/.gate-stamp"
refuse "a stamp that is only the payload's iv is refused (16 Nov 2026: line 2 must say PASS, and over what)" fin A "Update working state" "session-a"
says "does not say that the payload" "…and says why"
says "node checks/gate.js" "…with the command to run"
printf 'AAAAAAAAAAAAAAA2\nFAIL\n' > "$A/.gate-stamp"
refuse "…and one whose second line is not a pass" fin A "Update working state" "session-a"
gstamp "$A" AAAAAAAAAAAAAAA2 HEAD
refuse "…and a pass over HEAD (a committed payload passes over itself with no change set)" fin A "Update working state" "session-a"
says "over HEAD" "…quoting the line"
gstamp "$A" AAAAAAAAAAAAAAA2 "$(git -C "$A" rev-parse --short=12 HEAD~2)"
refuse "…and a pass over some other commit" fin A "Update working state" "session-a"
test "$(gp rev-parse site-queue)" = "$q0" && ok "…nothing was queued by any of them" || no "a payload with a bad stamp was queued"
gstamp "$A" AAAAAAAAAAAAAAA2 "$(printf %.12s "$q0")"
check "a pass over the queue's head, named by its commit, goes out" fin A "Update working state" "session-a"
quiet lock A take "session-a" "checks"; pc A AAAAAAAAAAAAAAA3; gstamp "$A" AAAAAAAAAAAAAAA3 queue/site-queue
check "…and so does one over queue/site-queue" fin A "Update working state" "session-a"
quiet lock A take "session-a" "checks"; pc A AAAAAAAAAAAAAAA4
check "…and the gate's own base, origin/main" fin A "Update working state" "session-a"
quiet lock A take "session-a" "many"
for i in $(seq 1 31); do mc A "n$i"; done
refuse "more commits than the airlock takes at once are refused" fin A "Update working state" "session-a"
says "at most 30" "…and says why"
git -C "$A" reset -q --hard HEAD~31; quiet lock A release "session-a"
echo "checkpoint" >> "$PA/_work/go1/NOTES.md"; echo "an open item" >> "$PA/OPEN-ITEMS.md"; echo "a memory" >> "$PA/notes/memory.md"
echo "a deploy's story" >> "$PA/CHANGE-LOG-COMMITS.md"; mkdir -p "$PA/ledger/pending" && echo '{"why":"a draft"}' > "$PA/ledger/pending/draft.json"
printf '{"investigations":[],"updated":"2026-10-19"}\n' > "$PA/research.json"; echo '{"id":"CS-1"}' >> "$PA/ledger/changes.jsonl"
echo '{"id":"R-0001"}' >> "$PA/ledger/register.jsonl"; echo '{"links":{}}' > "$PA/ledger/link-confidence.json"
check "the notes checkpoint pushes _work" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
gp show main:_work/go1/NOTES.md | grep -q checkpoint && ok "…GitHub has the notes" || no "notes not pushed"
gp show main:OPEN-ITEMS.md | grep -q "an open item" && gp show main:notes/memory.md | grep -q "a memory" && gp show main:CHANGE-LOG-COMMITS.md | grep -q "a deploy's story" \
  && gp show main:ledger/pending/draft.json | grep -q "a draft" && ok "…and notes/, the open items, the changelog and the pending change files (16 Nov 2026)" || no "the checkpoint left a notes file behind"
if ! gp show main:research.json | grep -q 2026-10-19 && ! gp show main:ledger/changes.jsonl | grep -q CS-1 && ! gp show main:ledger/register.jsonl | grep -q R-0001 \
   && ! gp show main:ledger/link-confidence.json >/dev/null 2>&1 && ! git -C "$PA" diff --quiet HEAD -- research.json ledger/changes.jsonl ledger/register.jsonl \
   && [ -n "$(git -C "$PA" ls-files --others --exclude-standard -- ledger/link-confidence.json)" ]; then
  ok "…and nothing that must match the site: research.json, the ledger and the line figures stay uncommitted here"; else no "notes took state files"; fi
check "a second checkpoint with nothing new is fine" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "nothing new" "…and says so"
gnohook -C "$PA" commit -qm "Update working state" -- research.json
refuse "the checkpoint does not push other unpushed private commits" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "not notes" "…and says why"
git -C "$PA" reset -q --hard origin/main; rm -f "$PA/ledger/link-confidence.json"
quiet lock A take "session-a" "conflict"
echo "a's line" >> "$PA/OPEN-ITEMS.md"
quiet git -C "$PB" pull -q --ff-only && echo "b's line" >> "$PB/OPEN-ITEMS.md" && gnohook -C "$PB" commit -qam "Update working state" && quiet git -C "$PB" push -q origin HEAD:main
q0="$(gp rev-parse site-queue)"; pm0="$(git -C "$PA" rev-parse HEAD)"; mc A a3
refuse "finish stops when GitHub's newer private commits change the same lines" fin A "Update working state" "session-a"
says "change the same files" "…and says why"
test "$(gp rev-parse site-queue)" = "$q0" && ok "…nothing was queued" || no "queued after a failed state push"
test "$(git -C "$PA" rev-parse HEAD)" = "$pm0" && grep -q "a's line" "$PA/OPEN-ITEMS.md" && ! git -C "$PA" diff --quiet HEAD -- OPEN-ITEMS.md \
  && ok "…the state commit is undone, its changes kept uncommitted" || no "state after a refused push"
[ ! -d "$(git -C "$PA" rev-parse --absolute-git-dir)/rebase-merge" ] && [ -z "$(git -C "$PA" ls-files -u)" ] && ok "…and no rebase is left half-done" || no "rebase left behind"
git -C "$PA" reset -q --hard && quiet git -C "$PA" pull -q --ff-only && git -C "$A" reset -q --hard HEAD~1 && quiet lock A release "session-a"
echo "a copy" > "$AA/archive/hand-a.txt"
refuse "finish stops while the source archive has uncommitted changes (a copy would vanish)" fin A "Update working state"
says "source archive" "…and says why"
git -C "$AA" add archive/hand-a.txt && gnohook -C "$AA" commit -qm "add hand copies of new sources"
check "…and pushes the archive's own commits before the state" fin A "Update working state"
git --git-dir="$GHA" show main:archive/hand-a.txt >/dev/null 2>&1 && ok "…GitHub's archive has the copy" || no "archive not pushed"
echo "another" > "$AA/archive/hand-b.txt" && git -C "$AA" add archive/hand-b.txt && gnohook -C "$AA" commit -qm "add hand copies of new sources"
check "the notes checkpoint pushes the archive's commits too" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
git --git-dir="$GHA" show main:archive/hand-b.txt >/dev/null 2>&1 && ok "…GitHub's archive has it" || no "notes did not push the archive"
mv "$T/A/home/.ft-ready" "$T/A/home/.ft-ready.off"; echo "after a stop" >> "$PA/_work/go1/NOTES.md"
check "the notes checkpoint still works after a setup that stopped (no ready mark)" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
mv "$T/A/home/.ft-ready.off" "$T/A/home/.ft-ready"
quiet lock A take "session-a" "long stretch"; mc A r1; echo "a long stretch" >> "$PA/OPEN-ITEMS.md"
quiet git -C "$PB" pull -q --ff-only
printf '{"who":"session-a","what":"long stretch","since":"%s"}\n' "$(date -u -d '13 hours ago' +%Y-%m-%dT%H:%M:%S.000Z)" > "$PB/ledger/LOCK" \
  && gnohook -C "$PB" commit -qm "Take the writer lock" -- ledger/LOCK && quiet git -C "$PB" push -q origin HEAD:main
refuse "finish stops when the session's writer lock is over 12 hours old" fin A "Update working state" "session-a"
says "hours old" "…and says to renew it"
check "…which take does, with the stretch's private changes still uncommitted" lock A take "session-a" "renew"
check "…and then finish goes through" fin A "Update working state" "session-a"
gp show main:OPEN-ITEMS.md | grep -q "a long stretch" && ok "…with those changes" || no "renewed stretch lost its changes"
quiet git -C "$PB" pull -q --ff-only

echo "6. stops"
mv "$T/A/home/.ft-ready" "$T/A/home/.ft-ready.off"
refuse "finish stops until setup has finished in the session" fin A "x"
mv "$T/A/home/.ft-ready.off" "$T/A/home/.ft-ready"
mkdir "$(git -C "$PA" rev-parse --absolute-git-dir)/rebase-merge"
refuse "finish stops while a rebase is unfinished" fin A "x"
rmdir "$(git -C "$PA" rev-parse --absolute-git-dir)/rebase-merge"
echo '{}' > "$A/stray.json"
refuse "finish stops on a private file outside the private repo" fin A "x"
rm "$A/stray.json"
cp --remove-destination "$PA/research.json" "$A/research.json"
refuse "finish stops when a tool replaced a top-level link by a real file" fin A "x"
rm "$A/research.json" && ln -s ../family-tree-private/research.json "$A/research.json"
cp --remove-destination "$PA/checks/priority-cards.json" "$A/checks/priority-cards.json"
refuse "finish stops when the link inside a public folder was replaced" fin A "x"
rm "$A/checks/priority-cards.json" && ln -s ../../family-tree-private/checks/priority-cards.json "$A/checks/priority-cards.json"
check "…and the links are whole again (setup agrees)" sh -c "cd '$T/A' && HOME='$T/A/home' FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
echo "<!-- uncommitted -->" >> "$A/README.md"
refuse "finish stops on uncommitted site changes" fin A "x"
git -C "$A" checkout -q -- README.md
pm0="$(gp rev-parse main)"; q0="$(gp rev-parse site-queue)"
echo "<!-- readme -->" >> "$A/README.md"; gnohook -C "$A" commit -qam "Update the readme"
refuse "finish (queue) stops on a commit that changes a file the airlock does not publish" fin A "x"
says "does not publish" "…and says why"
test "$(gp rev-parse main)" = "$pm0" && test "$(gp rev-parse site-queue)" = "$q0" && ok "…having pushed nothing" || no "pushed after a path stop"
git -C "$A" reset -q --hard HEAD~1
echo "<!-- page -->" >> "$A/index.html"; gnohook -C "$A" commit -qam "Update the page"
refuse "…and on an index.html change outside its payload line" fin A "x"
says "outside its payload line" "…and says why"
git -C "$A" reset -q --hard HEAD~1
mc A s1
refuse "finish stops when this session does not hold the writer lock" fin A "Update working state" "session-a"
says "does not hold the writer lock" "…and says why"
quiet lock B take "session-b" "hold"
refuse "…or when another session holds it" fin A "Update working state" "session-a"
says "held by \"session-b\"" "…and says who"
quiet lock B release "session-b"
quiet git -C "$PB" pull -q --ff-only && git -C "$A" rev-parse HEAD > "$PB/.dropped-site-commits" && git -C "$PB" add .dropped-site-commits \
  && gnohook -C "$PB" commit -qm "Rebuild the site queue" && quiet git -C "$PB" push -q origin HEAD:main
refuse "the lock is refused to a clone that holds a commit a queue rebuild dropped" lock A take "session-a" "dropped"
says "dropped" "…and says why"
refuse "…and so is its finish" fin A "Update working state" "session-a"
says "dropped" "…naming it"
quiet git -C "$PB" pull -q --ff-only && : > "$PB/.dropped-site-commits" && gnohook -C "$PB" commit -qam "Update working state" && quiet git -C "$PB" push -q origin HEAD:main
git -C "$A" reset -q --hard HEAD~1 && quiet git -C "$PA" pull -q --ff-only

echo "6b. a failed push says why (16 Nov 2026)"
# what GitHub prints for each kind of refusal, as git shows it; ft_push_kind tells them apart
kind_is() { test "$( . "$TOOLS/cloud-lib.sh"; ft_push_kind "$2" )" = "$1"; }
check "a push rejected because the remote moved is told from the rest" kind_is moved ' ! [rejected]        HEAD -> main (fetch first)
error: failed to push some refs to the remote'
check "…a file over the size limit" kind_is large "remote: error: File big.bin is 120.00 MB; this exceeds GitHub's file size limit of 100.00 MB
remote: error: GH001: Large files detected.
 ! [remote rejected] HEAD -> main (pre-receive hook declined)"
check "…a protected branch" kind_is protected 'remote: error: GH006: Protected branch update failed for refs/heads/main.
 ! [remote rejected] HEAD -> main (protected branch hook declined)'
check "…a session without push access" kind_is denied "remote: Permission to owner/repo.git denied to someone.
fatal: unable to access 'https://example.invalid/owner/repo.git/': The requested URL returned error: 403"
check "…also when a proxy on the way refuses it" kind_is denied "fatal: unable to access 'https://example.invalid/owner/repo.git/': Received HTTP code 403 from proxy after CONNECT"
check "…two pushes that met at the same moment (tried again, like a remote that moved)" kind_is moved " ! [remote rejected] HEAD -> main (cannot lock ref 'refs/heads/main': is at 1111111 but expected 2222222)"
check "…a hook that declined it" kind_is refused ' ! [remote rejected] HEAD -> main (pre-receive hook declined)'
# a "[remote rejected]" for a fault on GitHub's own side passes: it is tried again, as before these kinds existed
check "…a fault on GitHub's own side, which is tried again like a server not reached" kind_is unreachable 'remote: Internal Server Error
 ! [remote rejected] main -> main (Internal Server Error)
error: failed to push some refs to the remote'
check "…(another of its wordings)" kind_is unreachable 'remote: fatal error in commit_refs
 ! [remote rejected] HEAD -> main (failure)'
check "…(and a third)" kind_is unreachable ' ! [remote rejected] HEAD -> main (unpacker error)'
check "…and a server that was not reached" kind_is unreachable "fatal: unable to access 'https://example.invalid/': Could not resolve host: example.invalid"
# "GitHub" refuses pushes to a repo's main with the words in $T/refuse-<repo> while that file is there
# (and, while $T/refuse-release is there, the push that releases the writer lock)
for g in "$GHA" "$GHP"; do n="$(basename "$g" .git)"; cat > "$g/hooks/update" <<EOF
#!/bin/sh
[ "\$1" = refs/heads/main ] && [ -e "$T/refuse-$n" ] && { cat "$T/refuse-$n" >&2; exit 1; }
[ "\$1" = refs/heads/main ] && [ -e "$T/refuse-release" ] && [ "\$(git log -1 --format=%s "\$3")" = "Release the writer lock" ] \\
  && { echo "Permission to owner/$n.git denied to someone." >&2; exit 1; }
exit 0
EOF
chmod +x "$g/hooks/update"; done
echo "one more" > "$AA/archive/hand-c.txt" && git -C "$AA" add archive/hand-c.txt && gnohook -C "$AA" commit -qm "add hand copies of new sources"
printf '%s\n' "error: File archive/big.bin is 120.00 MB; this exceeds GitHub's file size limit of 100.00 MB" "error: GH001: Large files detected." > "$T/refuse-family-tree-sources"
pm0="$(gp rev-parse main)"; echo "a line" >> "$PA/OPEN-ITEMS.md"
refuse "finish stops when GitHub refuses the archive push for a file's size" fin A "Update working state"
says "over its size limit" "…and says that, not that GitHub is out of reach"
says "exceeds GitHub's file size limit" "…with git's own words"
says "changes nothing" "…and that running it again does not help"
test "$(gp rev-parse main)" = "$pm0" && ok "…having pushed nothing" || no "pushed after a refused archive push"
refuse "…the notes checkpoint stops on it too" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "over its size limit" "…with the same reason"
rm -f "$T/refuse-family-tree-sources"
printf '%s\n' "Permission to owner/family-tree-private.git denied to someone." > "$T/refuse-family-tree-private"
refuse "finish stops when the session may not push the private state" fin A "Update working state"
says "may not push to family-tree-private" "…and says so, with what to do"
says "archive: pushed" "…the archive's commits had gone up first, as before"
test -z "$(git -C "$PA" log --oneline '@{upstream}..HEAD')" && ! git -C "$PA" diff --quiet HEAD -- OPEN-ITEMS.md && ok "…the state commit is undone, its changes kept" || no "state after a refused private push"
refuse "the lock is not taken when GitHub refuses its push" lock A take "session-a" "refused"
says "may not push to family-tree-private" "…and says why"
test -z "$(git -C "$PA" log --oneline '@{upstream}..HEAD')" && ok "…leaving no lock commit behind" || no "lock commit left after a refused push"
rm -f "$T/refuse-family-tree-private"
git -C "$PA" remote set-url --push origin "file://$T/gh/no-such-repo.git"
refuse "finish stops when the private repo cannot be reached for the push" fin A "Update working state"
says "could not be reached" "…and says to run it again"
says "git said:" "…with git's own words"
git -C "$PA" remote set-url --delete --push origin "file://$T/gh/no-such-repo.git"
check "…and goes through once it can be reached" fin A "Update working state"
gp show main:OPEN-ITEMS.md | grep -q "a line" && ok "…with the state" || no "state not pushed after the retry"
quiet git -C "$PB" pull -q --ff-only

echo "6b2. a lock that could not be released (16 Nov 2026)"
quiet lock A take "session-a" "left"; mc A left1; echo "left" >> "$PA/OPEN-ITEMS.md"; touch "$T/refuse-release"
fin A "Update working state" "session-a" > "$T/last.out" 2>&1; rc=$?
[ "$rc" = 4 ] && ok "a finish whose lock release fails after queuing exits 4" || { no "exit 4 (got $rc)"; tail -8 "$T/last.out"; }
grep -v '^$' "$T/last.out" | tail -n 4 | grep -q 'THE WRITER LOCK IS STILL HELD by "session-a"' && ok "…and says so in its last lines" || no "the lock message is not last"
says 'Release it now, from this machine:  bash tools/cloud-lock.sh release "session-a"' "…with the exact command"
says "may not push to family-tree-private" "…after the reason the release failed"
test "$(gp rev-parse site-queue)" = "$(git -C "$A" rev-parse HEAD)" && gp show main:OPEN-ITEMS.md | grep -qx "left" && ok "…everything else went up" || no "state or queue after a failed release"
gp show main:ledger/LOCK | grep -q session-a && ok "…and GitHub still shows the lock held" || no "the lock after a failed release"
rm -f "$T/refuse-release"
check "the printed command releases it" lock A release "session-a"
gp show main:ledger/LOCK | grep -qx free && ok "…GitHub shows it free" || no "the lock was not released by the printed command"
quiet lock A take "session-a" "left again"; echo "state only" >> "$PA/OPEN-ITEMS.md"; touch "$T/refuse-release"
fin A "Update working state" "session-a" > "$T/last.out" 2>&1; rc=$?
[ "$rc" = 4 ] && grep -q "nothing new to publish" "$T/last.out" && ok "a finish with nothing to publish exits 4 as well when its release fails" || no "exit 4 on a state-only finish (got $rc)"
rm -f "$T/refuse-release"; quiet lock A release "session-a"
gp show main:ledger/LOCK | grep -qx free || no "the lock stayed held after the state-only case"
quiet git -C "$PB" pull -q --ff-only

echo "6c. files a finish will not push (16 Nov 2026)"
# git ignores images under _work/ and everything in the archive's inbox: never pushed, and now said
head -c 64 /dev/urandom > "$PA/_work/go1/scan.png"; head -c 64 /dev/urandom > "$AA/archive/inbox/capture.jpg"
echo "with a scan" >> "$PA/_work/go1/NOTES.md"
check "the notes checkpoint still goes through with ignored files in _work/ and the archive's inbox" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "NOT pushed, and vanish with this machine" "…and says they are not pushed"
says "family-tree-private/_work/go1/scan.png" "…naming the image in _work/"
says "family-tree-sources/archive/inbox/capture.jpg" "…and the capture in the inbox"
says "archive/hand/" "…and where a kept one belongs"
! gp show main:_work/go1/scan.png >/dev/null 2>&1 && gp show main:_work/go1/NOTES.md | grep -q "with a scan" && ok "…the notes went up, the image did not" || no "ignored image and the checkpoint"
echo "again" >> "$PA/OPEN-ITEMS.md"
check "a full finish goes through with them too" fin A "Update working state"
says "family-tree-sources/archive/inbox/capture.jpg" "…with the same note"
rm -f "$PA/_work/go1/scan.png" "$AA/archive/inbox/capture.jpg"
mkdir -p "$PA/_work/fresh/deep"; head -c 64 /dev/urandom > "$PA/_work/fresh/a.png"; head -c 64 /dev/urandom > "$PA/_work/fresh/deep/b.png"
check "a new folder that holds only ignored files does not stop the checkpoint" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "NOTE: 1 file(s) or folder(s) here are ignored" "…and is named once, as the folder (git names the folder and each file in it)"
says "family-tree-private/_work/fresh/$" "…by its name"
lacks "_work/fresh/a.png\|_work/fresh/deep" "…(not its files as well)"
rm -rf "$PA/_work/fresh"
check "with none left, a finish says nothing of the kind" fin A "Update working state"
lacks "ignored by git" "…(no note)"
# GitHub refuses a file of 100 MB: the finish stops at 95, before anything is committed or pushed
truncate -s 95M "$PA/_work/go1/download.bin"; echo "kept" >> "$PA/_work/go1/NOTES.md"; pm0="$(gp rev-parse main)"
refuse "the notes checkpoint stops on a new file of 95 MB" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "family-tree-private/_work/go1/download.bin  (95 MB, not committed yet)" "…naming it"
says "Nothing was pushed" "…having pushed nothing"
refuse "…and so does a full finish" fin A "Update working state"
says "95 MB or more" "…with the reason"
test "$(gp rev-parse main)" = "$pm0" && git -C "$PA" diff --quiet --cached && ok "…nothing was committed or pushed" || no "a big file got past the finish"
mv "$PA/_work/go1/download.bin" "$PA/_work/go1/download.png"
check "an ignored file of that size does not stop it (it is never pushed)" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "family-tree-private/_work/go1/download.png" "…it is in the note instead"
rm -f "$PA/_work/go1/download.png"
truncate -s 96M "$AA/archive/big.pdf" && git -C "$AA" add archive/big.pdf && gnohook -C "$AA" commit -qm "add hand copies of new sources"
am0="$(git --git-dir="$GHA" rev-parse main)"; echo "after" >> "$PA/_work/go1/NOTES.md"
refuse "a finish stops on a file of 95 MB in the archive's unpushed commits" fin A "Update working state"
says "family-tree-sources/archive/big.pdf  (96 MB, in a commit GitHub does not have yet)" "…naming it"
test "$(git --git-dir="$GHA" rev-parse main)" = "$am0" && ok "…the archive was not pushed" || no "the archive went up with a big file"
refuse "…and the notes checkpoint stops on it too" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
git -C "$AA" reset -q --hard HEAD~1
check "with the file gone, the finish goes through" fin A "Update working state"
quiet git -C "$PB" pull -q --ff-only

echo "6d. the archive's source list keeps itself current (16 Nov 2026)"
stamp_data() { # $1 = site clone: mark its data.json as coming from the index.html on disk, as tools/crypt.js does
  ( cd "$1" && node -e 'const fs=require("fs"),c=require("crypto");const e=JSON.parse(fs.readFileSync("index.html","utf8").match(/const ENC = (\{[^}]*\});/)[1].replace(/(\w+):/g,"\"$1\":"));fs.writeFileSync(".data-stamp",e.iv+":"+c.createHash("sha256").update(e.ct).digest("hex").slice(0,16)+"\n")' )
}
cp "$A/data.json" "$T/data.keep"
echo "a line more" >> "$PA/OPEN-ITEMS.md"; am0="$(git --git-dir="$GHA" rev-parse main)"
check "a finish whose data.json has no stamp leaves the source list alone" fin A "Update working state"
says "NOTE: the archive's source list (sources/urls.tsv) was not brought up to date" "…with a note, not a stop"
test "$(git --git-dir="$GHA" rev-parse main)" = "$am0" && test -z "$(git -C "$AA" status --porcelain)" && ok "…and the archive is untouched" || no "the archive changed without a current data.json"
printf '{"id":"c001","name":"Selftest Person","src":[{"l":"A register","u":"https://example.invalid/register/1"}],"unions":[{"s":"Other Person","c":[{"id":"c002","name":"Selftest Child","src":[{"l":"A register","u":"https://example.invalid/register/1"},{"l":"A notice","u":"https://example.invalid/notice/2"}],"unions":[]}]}]}\n' > "$A/data.json"
refuse "tools/doctor.js --data-current says no for a data.json with no stamp" env FT_ROOT="$A" node "$TOOLS/doctor.js" --data-current
stamp_data "$A"; echo "another" >> "$PA/OPEN-ITEMS.md"
check "…and yes once it is stamped from the index.html on disk" env FT_ROOT="$A" node "$TOOLS/doctor.js" --data-current
check "with a current data.json, a full finish rebuilds the list" fin A "Update working state"
says "sources/urls.tsv rebuilt from data.json (2 addresses) and committed" "…and says so"
git --git-dir="$GHA" show main:sources/urls.tsv | grep -q "example.invalid/notice/2" && test "$(git --git-dir="$GHA" log -1 --format=%s main)" = "update the source list" \
  && ok "…GitHub's archive has the new list, in a commit of its own" || no "the source list did not reach the archive"
! git --git-dir="$GHA" show main:sources/urls.tsv | grep -q "Selftest" && ok "…which names no card" || no "the archive's list names a card"
gp show main:sources/MANIFEST.json | grep -q '"count": 2' && ok "…and the full manifest went with the private state" || no "MANIFEST.json not in the private repo"
am1="$(git --git-dir="$GHA" rev-parse main)"; echo "once more" >> "$PA/OPEN-ITEMS.md"
check "a second finish with the same data makes no new archive commit" fin A "Update working state"
test "$(git --git-dir="$GHA" rev-parse main)" = "$am1" && ok "…the archive is as it was" || no "the list was committed twice"
# another session moved the archive on GitHub meanwhile: the list's commit goes on top of its commits
rm -rf "$T/arc2" && quiet git clone "file://$GHA" "$T/arc2" && echo "elsewhere" > "$T/arc2/archive/hand-z.txt" && git -C "$T/arc2" add -A \
  && gnohook -C "$T/arc2" commit -qm "add hand copies of new sources" && quiet git -C "$T/arc2" push -q origin HEAD:main
sed -i 's#notice/2#notice/3#' "$A/data.json"; echo "and again" >> "$PA/OPEN-ITEMS.md"
check "a finish behind GitHub's archive still brings the list up to date" fin A "Update working state"
git --git-dir="$GHA" show main:sources/urls.tsv | grep -q "notice/3" && git --git-dir="$GHA" show main:archive/hand-z.txt >/dev/null 2>&1 \
  && ok "…on top of the other session's commits" || no "the list and a moved archive"
# the list's commit must never stop anything: a session that may not push the archive used to stop here, at
# every later finish and at every notes checkpoint, with the commit left in its clone
alist() { git -C "$AA" log --format=%s origin/main..HEAD | tr '\n' '|'; }      # the archive clone's unpushed commits
printf '%s\n' "Permission to owner/family-tree-sources.git denied to someone." > "$T/refuse-family-tree-sources"
sed -i 's#notice/3#notice/4#' "$A/data.json"; echo "no archive push" >> "$PA/OPEN-ITEMS.md"; am1="$(git --git-dir="$GHA" rev-parse main)"
check "a finish that rebuilt the list and may not push the archive goes through all the same" fin A "Update working state"
says "NOTE: the archive's rebuilt source list (sources/urls.tsv) could not be pushed, so its commit was undone here" "…with a note that the list's commit was undone"
says "may not push to family-tree-sources" "…and why, in git's own words too"
gp show main:OPEN-ITEMS.md | grep -qx "no archive push" && ok "…the state went up" || no "the state after a list that could not be pushed"
test -z "$(alist)" && test -z "$(git -C "$AA" status --porcelain)" && test "$(git --git-dir="$GHA" rev-parse main)" = "$am1" \
  && ok "…and the archive clone holds no commit of its own, clean" || no "the list's commit was left in the archive clone ($(alist))"
echo "after the list" >> "$PA/_work/go1/NOTES.md"
check "…and a notes checkpoint after it still saves" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
gp show main:_work/go1/NOTES.md | grep -qx "after the list" && ok "…GitHub has the notes" || no "the checkpoint after a list that could not be pushed"
# a list commit left in the clone (as an earlier finish could leave one) does not stop a checkpoint either
echo "# left over" >> "$AA/sources/urls.tsv" && gnohook -C "$AA" commit -qm "update the source list" -- sources/urls.tsv
echo "with a list left over" >> "$PA/_work/go1/NOTES.md"
check "a checkpoint that finds a list commit it cannot push undoes it and saves the notes" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "could not be pushed, so its commit was undone here" "…with the same note"
test -z "$(alist)" && test -z "$(git -C "$AA" status --porcelain)" && gp show main:_work/go1/NOTES.md | grep -qx "with a list left over" \
  && ok "…the archive clone is clean and GitHub has the notes" || no "a left-over list commit and the checkpoint"
# hand copies under the list's commit are another matter: evidence must go up first, so that still stops
echo "a new copy" > "$AA/archive/hand-d.txt" && git -C "$AA" add archive/hand-d.txt && gnohook -C "$AA" commit -qm "add hand copies of new sources"
echo "with a copy" >> "$PA/OPEN-ITEMS.md"; pm0="$(gp rev-parse main)"
refuse "hand copies that cannot be pushed still stop the finish (the evidence goes first)" fin A "Update working state"
says "the source archive could not be pushed" "…and says so"
test "$(alist)" = "add hand copies of new sources|" && test "$(gp rev-parse main)" = "$pm0" && ok "…only the list's commit was undone; the copies wait, nothing else pushed" || no "hand copies under a list commit ($(alist))"
rm -f "$T/refuse-family-tree-sources"
check "once the archive can be pushed, the finish takes the copies and the list up" fin A "Update working state"
git --git-dir="$GHA" show main:archive/hand-d.txt >/dev/null 2>&1 && git --git-dir="$GHA" show main:sources/urls.tsv | grep -q "notice/4" \
  && test "$(git --git-dir="$GHA" log -1 --format=%s main)" = "update the source list" && ok "…the list in a commit of its own, on top" || no "the copies and the list after the refusal"
# a list commit that clashes with a list another session pushed (the same lines): undone as well
quiet git -C "$T/arc2" pull -q --ff-only && sed -i 's#notice/4#notice/5#' "$T/arc2/sources/urls.tsv" && gnohook -C "$T/arc2" commit -qam "update the source list" \
  && quiet git -C "$T/arc2" push -q origin HEAD:main
sed -i 's#notice/4#notice/6#' "$AA/sources/urls.tsv" && gnohook -C "$AA" commit -qm "update the source list" -- sources/urls.tsv
echo "with a clash" >> "$PA/_work/go1/NOTES.md"
check "a list commit that clashes with another session's list does not stop the checkpoint" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "newer commits change the same lines (sources/urls.tsv" "…the note says why"
test -z "$(alist)" && test -z "$(git -C "$AA" status --porcelain)" && ! ( . "$TOOLS/cloud-lib.sh"; ft_midop "$AA" ) && gp show main:_work/go1/NOTES.md | grep -qx "with a clash" \
  && ok "…no rebase is left open in the archive, and GitHub has the notes" || no "a clashing list commit and the checkpoint"
echo "after the clash" >> "$PA/OPEN-ITEMS.md"
check "the next full finish puts the list right again, on top of the other session's" fin A "Update working state"
git --git-dir="$GHA" show main:sources/urls.tsv | grep -q "notice/4" && ! git --git-dir="$GHA" show main:sources/urls.tsv | grep -q "notice/5" \
  && ok "…GitHub's archive has the list the cards give" || no "the list after a clash"
# a manifest.js that runs without its private list of hosts says, by its exit code, that its list is not
# complete, and writes nothing: the finish must believe the code and keep such a list out of the archive (a
# push of the list starts the archive's capture run). The real script first, in a copy of its own with no hosts
# file beside it, then by hand in the site clone with the link to the hosts file taken away (a hand run once
# left its incomplete lists in sources/, and the next full finish pushed them with the state); then a stand-in
# in the site clone, which writes a list all the same, leaves with the real script's code and prints none of
# its words, because the finish goes by the code alone.
mkdir -p "$T/mf/checks" && cp "$A/checks/manifest.js" "$A/checks/lib.js" "$T/mf/checks/"
mrc=0; ( cd "$T/mf" && FT_DATA="$A/data.json" node checks/manifest.js ) > "$T/last.out" 2>&1 || mrc=$?
mcode="$(sed -n 's/^const INCOMPLETE = \([0-9][0-9]*\);.*/\1/p' "$A/checks/manifest.js")"
[ "$mrc" = 3 ] && [ "$mcode" = 3 ] && [ ! -e "$T/mf/sources" ] \
  && ok "checks/manifest.js without its private hosts file writes nothing and leaves with exit code 3" \
  || no "manifest.js without its hosts file: exit $mrc, and the code it names is ${mcode:-none}"
says "NOTHING is written" "…and says so"
mv "$A/checks/source-hosts.json" "$T/hosts.link"; lists0="$(cat "$PA/sources/urls.tsv" "$PA/sources/MANIFEST.json" | sha256sum)"
mrc=0; ( cd "$A" && FT_DATA="$A/data.json" node checks/manifest.js ) > "$T/last.out" 2>&1 || mrc=$?
mv "$T/hosts.link" "$A/checks/source-hosts.json"
[ "$mrc" = 3 ] && [ "$(cat "$PA/sources/urls.tsv" "$PA/sources/MANIFEST.json" | sha256sum)" = "$lists0" ] && test -z "$(git -C "$PA" status --porcelain -- sources)" \
  && ok "…run by hand in a session without the hosts file, it leaves the lists in sources/ as they were: nothing for the next finish to push" \
  || no "a hand run of manifest.js without its hosts file changed sources/ (exit $mrc)"
echo '{"risk":{},"kind":{}}' > "$T/mf/checks/source-hosts.json"
check "…with the file, it leaves with 0" sh -c "cd '$T/mf' && FT_DATA='$A/data.json' node checks/manifest.js"
echo '[]' > "$T/mf/checks/source-hosts.json"
mrc=0; ( cd "$T/mf" && FT_DATA="$A/data.json" node checks/manifest.js ) > "$T/last.out" 2>&1 || mrc=$?
[ "$mrc" = 1 ] && ok "…and with a file it cannot use, with 1" || no "manifest.js with a hosts file of the wrong shape: exit $mrc"
cp "$A/checks/manifest.js" "$T/manifest.keep"; git -C "$A" update-index --assume-unchanged checks/manifest.js
cat > "$A/checks/manifest.js" <<EOF
'use strict';
// a stand-in for the selftest: a list written without the private hosts file
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'sources');
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), '{"count": 1, "entries": "not complete"}');
fs.writeFileSync(path.join(dir, 'urls.tsv'), '# not complete\\nmedium\\t1\\tpage\\thttps://example.invalid/not-complete\\n');
console.log('MANIFEST: 1 distinct URLs, 1 hosts');
process.exitCode = ${mcode:-0};
EOF
echo "not complete" >> "$PA/OPEN-ITEMS.md"; am1="$(git --git-dir="$GHA" rev-parse main)"
check "a manifest that says its list is not complete does not stop the finish" fin A "Update working state"
says "NOTE: the archive's source list (sources/urls.tsv) was not brought up to date: checks/manifest.js says this run's list is not complete" "…it is a note that says so"
says "bash tools/cloud-setup.sh" "…with what to do"
lacks "By hand" "…(and not the advice to copy the list by hand)"
test "$(git --git-dir="$GHA" rev-parse main)" = "$am1" && test -z "$(alist)" && test -z "$(git -C "$AA" status --porcelain)" \
  && ok "…the list did not go into the archive" || no "an incomplete list reached the archive"
grep -q "notice/4" "$PA/sources/urls.tsv" && ! grep -q "not-complete" "$PA/sources/urls.tsv" && grep -q '"count": 2' "$PA/sources/MANIFEST.json" \
  && ! gp show main:sources/urls.tsv | grep -q "not-complete" && gp show main:OPEN-ITEMS.md | grep -qx "not complete" \
  && ok "…the private lists are as they were before, and the state went up" || no "the private lists after an incomplete manifest"
cp "$T/manifest.keep" "$A/checks/manifest.js"; git -C "$A" update-index --no-assume-unchanged checks/manifest.js
test -z "$(git -C "$A" status --porcelain --untracked-files=no)" || no "the stand-in manifest.js was left in the site clone"
printf '{ not json\n' > "$A/data.json"; echo "last" >> "$PA/OPEN-ITEMS.md"; am1="$(git --git-dir="$GHA" rev-parse main)"
check "a manifest that fails does not stop the finish" fin A "Update working state"
says "node checks/manifest.js failed" "…it is a note"
grep -q "notice/4" "$PA/sources/urls.tsv" && ok "…and the private list is as it was" || no "the private list after a failed manifest"
test "$(git --git-dir="$GHA" rev-parse main)" = "$am1" && test -z "$(git -C "$AA" status --porcelain)" && gp show main:OPEN-ITEMS.md | grep -qx "last" \
  && ok "…the archive is left clean and the state went up" || no "a failed manifest and the finish"
cp "$T/data.keep" "$A/data.json"; rm -f "$A/.data-stamp"
quiet git -C "$PB" pull -q --ff-only

echo "6d2. the checkpoint when another session wrote to the same file (16 Nov 2026)"
notes() { in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"; }
# its notes commit against another session's notes: put together by hand, as the message says
quiet git -C "$PB" pull -q --ff-only && echo "b's item" >> "$PB/OPEN-ITEMS.md" && gnohook -C "$PB" commit -qam "Update working state" && quiet git -C "$PB" push -q origin HEAD:main
echo "a's item" >> "$PA/OPEN-ITEMS.md"
refuse "the checkpoint stops when another session's notes change the same lines" notes
says "Put the two together by hand" "…and says how to put the two together"
lacks "puts everything back" "…(without the claim that an abort puts everything back)"
( cd "$PA" && git rebase -q --autostash origin/main >/dev/null 2>&1; printf '%s\n' "b's item" "a's item" > "$T/both" \
  && grep -v -e '^<<<<<<<' -e '^=======' -e '^>>>>>>>' -e "s item$" OPEN-ITEMS.md > "$T/merged"; cat "$T/both" >> "$T/merged"; cp "$T/merged" OPEN-ITEMS.md \
  && git add OPEN-ITEMS.md && GIT_EDITOR=true gnohook rebase --continue >/dev/null 2>&1 )
check "…and after those steps the checkpoint goes through" notes
gp show main:OPEN-ITEMS.md | grep -qx "a's item" && gp show main:OPEN-ITEMS.md | grep -qx "b's item" && ok "…with both sessions' lines" || no "the notes after a hand rebase"
# a state file changed here and not committed against what another session pushed: no hand rebase (it would
# leave conflict marks in the file and no rebase to continue or abort), the file set aside instead
quiet git -C "$PB" pull -q --ff-only && printf '{"investigations":[],"updated":"by-b"}\n' > "$PB/research.json" && gnohook -C "$PB" commit -qam "Update working state" \
  && quiet git -C "$PB" push -q origin HEAD:main
printf '{"investigations":[],"updated":"by-a"}\n' > "$PA/research.json"; echo "a note to keep" >> "$PA/_work/go1/NOTES.md"
refuse "the checkpoint stops when an uncommitted state file clashes with what another session pushed" notes
says "this session has changed or made too" "…and says which kind of clash it is"
says "(research.json)" "…naming the file"
says "Do NOT rebase by hand" "…and not to rebase by hand"
lacks "rebase --continue\|rebase --autostash" "…(none of the hand-rebase steps)"
grep -q by-a "$PA/research.json" && ! ( . "$TOOLS/cloud-lib.sh"; ft_midop "$PA" ) && test -z "$(git -C "$PA" stash list)" \
  && ok "…everything here is as it was: the file, no rebase open, nothing left set aside" || no "the clone after a refused checkpoint"
mkdir -p "$T/A/home/.ft-tmp" && cp "$PA/research.json" "$T/A/home/.ft-tmp/" && git -C "$PA" checkout -- research.json
check "…and after its steps (the file copied aside and put back as committed) the checkpoint goes through" notes
gp show main:_work/go1/NOTES.md | grep -qx "a note to keep" && grep -q by-b "$PA/research.json" && grep -q by-a "$T/A/home/.ft-tmp/research.json" \
  && ok "…GitHub has the notes, the file here is the other session's, this session's copy is kept" || no "the notes after the file was set aside"
quiet git -C "$PB" pull -q --ff-only

echo "6e. setup says when a repository is not attached (16 Nov 2026)"
nosetup() { local n="$1"; shift; ( cd "$T/$n" && HOME="$T/$n/home" FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 "$@" bash "$TOOLS/cloud-setup.sh" ); }
mkdir -p "$T/NA/home" && quiet git clone --depth 1 "file://$GHS" "$T/NA/family-tree"
refuse "setup stops when family-tree-private is not attached to the session" nosetup NA env FT_PRIVATE_URL="file://$T/gh/not-attached.git"
says "could not clone family-tree-private" "…and names the repository"
says "starts with only the repositories its owner selected" "…says that a session has only the repositories selected for it"
says "must be attached" "…that the private ones must be attached"
says "bash tools/cloud-setup.sh  again" "…and that setup is then run again"
says "git said:" "…with git's own words"
quiet git clone --depth 1 "file://$GHP" "$T/NA/family-tree-private"
refuse "…and the same for the source archive" nosetup NA env FT_SOURCES_URL="file://$T/gh/not-attached.git"
says "could not clone family-tree-sources" "…naming it"
test ! -e "$T/NA/home/.ft-ready" && ok "…and the session is not marked ready" || no "ready after a failed clone"
mkdir -p "$T/NB/home"
refuse "setup stops when none of the project's repositories is here" nosetup NB env
says "starts with only the repositories its owner selected" "…and says why, and what to attach"

echo "7. the queue and the airlock"
publish() { gp push -q "$GHS" site-queue:refs/heads/main; }  # what the airlock does
verdict() { # $1 = result: write family-tree-private's airlock-status for the current queue
  rm -rf "$T/st" && git init -q "$T/st" && ( cd "$T/st" && printf '{"result":"%s","rule":"page","queue_head":"%s"}\n' "$1" \
    "$(gp rev-parse site-queue)" > status.json && git add status.json \
    && gnohook commit -qm "Record an airlock check" && git -c push.negotiate=false push -q -f "$GHP" HEAD:refs/heads/airlock-status )
}
publish
check "after the airlock publishes, a new session finds nothing waiting" cloud C2
says "nothing waiting" "…and says so"
# a queue that has waited (16 Nov 2026): commits dated six hours ago, queued by a finish dated the same
old="$(date -u -d '6 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
doc() { ( FT_ROOT="$T/$1/family-tree" FT_PRIVATE_DIR="$T/$1/family-tree-private" node "$TOOLS/doctor.js" > "$T/last.out" 2>&1 ); true; }
quiet cloud A; quiet lock A take "session-a" "old"
GIT_AUTHOR_DATE="$old" GIT_COMMITTER_DATE="$old" mc A old1; echo "old" >> "$PA/OPEN-ITEMS.md"
GIT_AUTHOR_DATE="$old" GIT_COMMITTER_DATE="$old" fin A "Update working state" "session-a" > "$T/last.out" 2>&1 || no "the old-dated finish failed"
says "NOTE: the platform may now say there are 1 unpushed commit(s) on branch 'main'" "a finish that queues says the platform may ask to push the commits, and not to"
check "setup goes on when the queue has waited for more than four hours" cloud Q1
says "WARNING: the queue's 1 commit(s) are still not published" "…with a warning"
says "the oldest was queued 6\\.[0-9] hours ago" "…and the age: the time since the finish that queued the oldest"
says "airlock-status" "…and where the verdict is read"
says "Its last recorded check" "…and the airlock's last recorded check"
check "…in the session that queued it, too" cloud A
says "the oldest was queued 6\\.[0-9] hours ago" "…with the same age"
rm -rf "$T/shp" && quiet git clone --depth 1 "file://$GHP" "$T/shp"
( . "$TOOLS/cloud-lib.sh"; ft_queue_wait "$A" "$T/shp" ) > "$T/last.out" 2>&1
says "^6\\.[0-9] 1 committed$" "a private clone too shallow to show that finish gives the time since the commit was made, and says so"
doc A
says "\\[WARN\\] the queue's 1 commit(s) are still not published: the oldest was queued 6\\.[0-9] hours ago" "tools/doctor.js gives the same warning"
says "airlock-status" "…and says where the verdict is read"
cloud A > "$T/last.out" 2>&1
says "NOTE: the platform may say there are 1 unpushed commit(s) on branch 'main' and ask to push them: do not" "setup says the platform may ask to push the queued commits, and not to"
doc A
says "NOTE: the platform may say there are 1 unpushed commit(s) on branch 'main' and ask to push them: do not" "…and so does tools/doctor.js"
lacks "sign of life" "…(with no heartbeat branch yet, neither says a word about one)"
# the airlock's heartbeat (16 Nov 2026): every run of it leaves one, so a stopped airlock no longer looks idle
heartbeat() { # $1 = hours ago, $2 = outcome (or "broken"): family-tree-private's branch airlock-heartbeat, as the airlock writes it
  rm -rf "$T/hb" && git init -q "$T/hb" && ( cd "$T/hb" && if [ "$2" = broken ]; then printf '{ broken\n' > heartbeat.json; else
    printf '{\n "at": "%s",\n "run": "1",\n "mode": "publish",\n "outcome": "%s",\n "queue_head": "",\n "main": ""\n}\n' \
      "$(date -u -d "$1 hours ago" +%Y-%m-%dT%H:%M:%SZ)" "$2" > heartbeat.json; fi
    git add heartbeat.json && gnohook commit -qm "Record an airlock heartbeat" && git -c push.negotiate=false push -q -f "$GHP" HEAD:refs/heads/airlock-heartbeat )
}
heartbeat 1 unchanged-check
check "a queue that has waited, under an airlock that ran an hour ago: setup goes on" cloud A
says "WARNING: the queue's 1 commit(s) are still not published" "…with the queue's warning"
says 'The airlock is running: its last run was 1\.[0-9] hours ago and left "unchanged-check"' "…which now says the airlock is running, and what its last run left"
says "it is in check mode" "…and what that word means"
lacks "WARNING: the airlock's last sign of life" "…(and no warning that it has stopped)"
doc A
says 'The airlock is running: its last run was 1\.[0-9] hours ago and left "unchanged-check"' "tools/doctor.js words its queue warning by the heartbeat too: the airlock is running"
says "So it ran and did not publish them" "…and that it ran and did not publish them"
lacks "has missed a run or has stopped" "…(it no longer says the airlock has missed a run or stopped, against setup's own words)"
lacks "the airlock is late" "…(nor asks for a report that the airlock is late)"
heartbeat 9 idle
check "the same queue under an airlock whose last sign of life is nine hours old: setup still goes on" cloud A
says "The airlock seems to have stopped: its last sign of life is 9\.[0-9] hours old" "…the queue's warning says it seems to have stopped"
says "WARNING: the airlock's last sign of life is 9\.[0-9] hours old" "…and a warning of its own says so"
says "Run workflow" "…with what to do: Cory starts it by hand from its Actions page"
says "This session may go on" "…and that the session may go on"
doc A
says "\\[WARN\\] the airlock's last sign of life is 9\.[0-9] hours old" "tools/doctor.js gives the same warning"
says "Run workflow" "…with the same way out"
says "The airlock seems to have stopped: its last sign of life is 9\.[0-9] hours old" "…and its queue warning says the airlock seems to have stopped"
publish
check "with nothing waiting, an old heartbeat is still a warning (an idle queue does not hide a stopped airlock)" cloud A
says "WARNING: the airlock's last sign of life is 9\.[0-9] hours old" "…it says so"
quiet cloud R1
check "…in a read-only session too" sh -c "cd '$T/R1' && HOME='$T/R1/home' FT_READONLY=1 FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
says "WARNING: the airlock's last sign of life" "…it says so there"
heartbeat 7 idle
check "a heartbeat seven hours old (two runs skipped, a third late) is no alarm" cloud A
lacks "WARNING: the airlock" "…(no warning)"
says "airlock: its last run left a sign of life 7\.[0-9] hours ago (idle)" "…only a line that says when it last ran"
doc A
lacks "sign of life" "…(and nothing from tools/doctor.js)"
# a heartbeat dated in the future is no sign of life: it read as "0.0 hours ago" for as long as the date lay ahead
heartbeat -72 idle
check "a heartbeat dated three days ahead does not stop setup" cloud A
says "NOTE: the airlock's sign of life could not be read" "…it is the note for one that cannot be read"
lacks "sign of life 0\.0 hours ago" "…(it is not taken for a run that has just ended)"
doc A
lacks "sign of life" "…(and tools/doctor.js says nothing)"
heartbeat 0 broken
check "a heartbeat that cannot be read does not stop setup" cloud A
says "NOTE: the airlock's sign of life could not be read" "…it is a note"
doc A
lacks "sign of life" "…(and tools/doctor.js says nothing)"
heartbeat 0 idle
# a commit made six hours ago and queued only now has not waited: no warning where the history shows that
quiet cloud A; quiet lock A take "session-a" "late"
GIT_AUTHOR_DATE="$old" GIT_COMMITTER_DATE="$old" mc A old2; echo "late" >> "$PA/OPEN-ITEMS.md"; quiet fin A "Update working state" "session-a"
check "a commit made long ago and queued just now is no stale queue" cloud A
lacks "still not published" "…(no warning)"
doc A
lacks "still not published" "…(none from tools/doctor.js either)"
publish
check "…and a queue with nothing waiting gets neither" cloud A
lacks "still not published\\|unpushed commit(s)" "…(no warning, no number of commits to push)"
says "the platform may ask to push commits on branch 'main'" "…only the standing note: a commit this session makes will put main ahead, and the platform will ask"
# tools/doctor.js gives the cloud's own commands (16 Nov 2026): cloud-lock.sh for the writer lock, never
# tools/lock.js alone (it neither pushes the lock nor sets FT_WHO), and cloud-finish.sh for a commit not yet queued
lk="$PA/ledger/LOCK"; cp "$lk" "$T/lock.keep"
printf '{"who":"someone-else","what":"a stretch","since":"%s"}\n' "$(date -u -d '13 hours ago' +%Y-%m-%dT%H:%M:%S.000Z)" > "$lk"
doc A
says "over 12 hours, so it no longer counts" "tools/doctor.js says a lock over 12 hours old no longer counts"
says 'to write, take it: bash tools/cloud-lock.sh take "<who>" "<what>"' "…and gives cloud-lock.sh's command to take it"
lacks "fix: node tools/lock.js\|GitHub Desktop" "…(not tools/lock.js alone, and nothing from the time of the PC)"
printf '{"who":"someone-else","what":"a stretch","since":"%s"}\n' "$(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S.000Z)" > "$lk"
doc A
says "another session is writing: wait for it" "…for a younger lock held by another session: wait"
says 'bash tools/cloud-lock.sh take "<who>" "<what>" --steal' "…and --steal, with cloud-lock.sh, only if that session is gone"
( export FT_WHO=someone-else; doc A )
says 'held by this session ("someone-else")' "…and the session that holds the lock is told it is its own"
cp "$T/lock.keep" "$lk"
test -z "$(git -C "$PA" status --porcelain -- ledger/LOCK)" || no "the selftest left the lock file changed"
mc A docx
doc A
says "1 commit(s) neither pushed nor queued" "tools/doctor.js names a site commit that is not queued yet"
says "fix: bash tools/cloud-finish.sh" "…with cloud-finish.sh as the way out"
lacks "GitHub Desktop\|On the PC" "…(and no advice to push it)"
git -C "$A" reset -q --hard HEAD~1
check "session D sets up from public main" cloud D
check "session E sets up from the same main" cloud E
quiet lock E take "E" "work"; mc E w-e
side e-side                                  # public main moves past the tools and the lock
pm0="$(gp rev-parse main)"
refuse "E's finish stops: other site work came in under its commits" fin E "Update working state" "E"
says "not on top of the newest" "…and says why"
test "$(gp rev-parse main)" = "$pm0" && ok "…having pushed nothing" || no "E pushed its state"
quiet lock E release "E"
check "D queues its work (its take moves it up to the new main first)" work D
check "a later session starts from D's queued commit" cloud F0
test "$(git -C "$T/F0/family-tree" rev-parse HEAD)" = "$(gp rev-parse site-queue)" && ok "…its main is the queue's head" || no "F0 main"
refuse "direct publishing stops while the queue holds unpublished commits" sh -c "echo '<!-- f0 -->' >> '$T/F0/family-tree/README.md' && git -c core.hooksPath=/dev/null -C '$T/F0/family-tree' commit -qam 'Update readme' && HOME='$T/F0/home' FT_PUBLISH=direct FT_SKIP_LIVE=1 bash '$TOOLS/cloud-finish.sh' 'Update working state' 'f0'"
says "has not published yet" "…and says why"
git -C "$T/F0/family-tree" reset -q --hard HEAD~1
quiet lock D take "D" "more"                 # a stretch under way when the airlock refuses
verdict refused
refuse "a queue the airlock refused blocks every later session" cloud G
says "PUBLISH BLOCKED" "…and names it"
refuse "…and the writer lock in sessions set up before" lock F0 take "f0" "test"
says "PUBLISH BLOCKED" "…naming it too"
mc D d2
check "a finish already under way still queues, on top of the refused queue" fin D "Update working state" "D"
says "has refused the queue under these commits" "…with a warning"
quiet cloud G2   # the clones (this setup stops: PUBLISH BLOCKED)
check "a read-only session is not stopped by a refused queue" sh -c "cd '$T/G2' && HOME='$T/G2/home' FT_READONLY=1 FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
grep -q "read-only session: main stays at public main" "$T/last.out" && test "$(git -C "$T/G2/family-tree" rev-parse HEAD)" = "$(git --git-dir="$GHS" rev-parse main)" \
  && ok "…it says so and stays on public main" || no "read-only on a refused queue"
lacks "platform may" "…(and gets no note about pushing: it commits nothing)"
refuse "…and its finish refuses to push" fin G2 "Update working state"
says "read-only" "…and says why"
refuse "…and so does its lock" lock G2 take "g2" "test"
verdict published; publish
check "once published, sessions start again" cloud H
rm -rf "$T/st" && git init -q "$T/st" && ( cd "$T/st" && printf '{ broken\n' > status.json && git add status.json \
  && gnohook commit -qm "Record an airlock check" && git -c push.negotiate=false push -q -f "$GHP" HEAD:refs/heads/airlock-status )
refuse "a verdict that cannot be read stops setup (never a pass)" cloud V
says "could not be read" "…and says why"
refuse "…and the writer lock" lock H take "h" "test"
says "could not be read" "…naming it"
verdict published
echo "<!-- direct -->" >> "$T/H/family-tree/README.md" && gnohook -C "$T/H/family-tree" commit -qam "Update readme directly"
refuse "direct publishing stops without the writer lock" in_cloud H env FT_PUBLISH=direct FT_SKIP_LIVE=1 bash "$TOOLS/cloud-finish.sh" "Update working state" "h"
says "writer lock" "…and says why"
quiet lock H take "h" "direct"
check "direct publishing (interactive, empty queue, the lock held) pushes public main" in_cloud H env FT_PUBLISH=direct FT_SKIP_LIVE=1 bash "$TOOLS/cloud-finish.sh" "Update working state" "h"
test "$(git --git-dir="$GHS" rev-parse main)" = "$(git -C "$T/H/family-tree" rev-parse HEAD)" && ok "…public main is that commit" || no "direct push"
gp show main:ledger/LOCK | grep -qx free && ok "…and the lock is released" || no "direct did not release"
echo "<!-- direct, again -->" >> "$T/H/family-tree/README.md" && gnohook -C "$T/H/family-tree" commit -qam "Update readme directly"
quiet lock H take "h" "direct"; touch "$T/refuse-release"
in_cloud H env FT_PUBLISH=direct FT_SKIP_LIVE=1 bash "$TOOLS/cloud-finish.sh" "Update working state" "h" > "$T/last.out" 2>&1; rc=$?
[ "$rc" = 4 ] && grep -q 'THE WRITER LOCK IS STILL HELD by "h"' "$T/last.out" && test "$(git --git-dir="$GHS" rev-parse main)" = "$(git -C "$T/H/family-tree" rev-parse HEAD)" \
  && ok "a direct finish whose lock release fails exits 4 too, the site pushed" || no "direct and a failed release (got $rc)"
rm -f "$T/refuse-release"; quiet lock H release "h"
# the live check after a direct push: a page whose code changed and whose payload did not keeps its iv, so only
# the page's own bytes tell the new page from the old one (a local "site" serves whichever page is put in it)
mkdir -p "$T/www"; git --git-dir="$GHS" show main:index.html > "$T/www/index.html"
port=$(( 20000 + RANDOM % 20000 )); ( cd "$T/www" && exec python3 -m http.server --bind 127.0.0.1 "$port" ) >/dev/null 2>&1 & wwwpid=$!
sleep 1
codec() { # $1 = a comment: a commit of page code (the payload unchanged, so the gate's stamp still holds)
  echo "<!-- $1 -->" >> "$T/H/family-tree/index.html" && gnohook -C "$T/H/family-tree" commit -qam "Update page code" \
    && gstamp "$T/H/family-tree" "$(grep -o 'const ENC = {v:[0-9]*, iter:[0-9]*, salt:"[^"]*", iv:"[^"]*"' "$T/H/family-tree/index.html" | head -n 1 \
       | sed 's/.*iv:"//; s/"$//')"
}
livefin() { quiet lock H take "h" "direct"; in_cloud H env FT_PUBLISH=direct SITE="http://127.0.0.1:$port/" NO_PROXY=127.0.0.1 no_proxy=127.0.0.1 \
  FT_LIVE_TRIES=2 FT_LIVE_WAIT=0 bash "$TOOLS/cloud-finish.sh" "Update working state" "h"; }
codec "code only"
refuse "after a direct push of page code, the old page with the same payload is not reported live" livefin
says "the page's bytes are this commit's: no" "…and says the page's bytes are not this commit's"
codec "code only, again"
git -C "$T/H/family-tree" show HEAD:index.html > "$T/www/index.html"
check "…and once the site serves the new page, it is reported live" livefin
says "serves this commit's page" "…by its payload and its bytes"
kill "$wwwpid" 2>/dev/null; wait "$wwwpid" 2>/dev/null
mkdir -p "$T/R1/home" && quiet git clone --depth 1 "file://$GHP" "$T/R1/family-tree-private" \
  && quiet git clone --depth 1 "file://$GHA" "$T/R1/family-tree-sources"
check "a routine without the site attached clones it read-only and sets up" sh -c "cd '$T/R1' && HOME='$T/R1/home' FT_SITE_URL='file://$GHS' FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
test -L "$T/R1/family-tree/research.json" && ok "…with every private link in place" || no "routine links"
# a routine's own clone of the site, with setup run from the copy inside it (tools/cloud-setup.sh)
mkdir -p "$T/R2/home" && quiet git clone --depth 1 "file://$GHS" "$T/R2/family-tree" \
  && quiet git clone --depth 1 "file://$GHP" "$T/R2/family-tree-private" \
  && quiet git clone --depth 1 "file://$GHA" "$T/R2/family-tree-sources" \
  && cp "$TOOLS/cloud-setup.sh" "$TOOLS/cloud-lib.sh" "$T/R2/family-tree/tools/"
check "setup run from the copy inside a site clone sets up that clone" sh -c "cd '$T/R2/home' && HOME='$T/R2/home' FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$T/R2/family-tree/tools/cloud-setup.sh'"
grep -q "FT_DIR=\"$(cd -P "$T/R2/family-tree" && pwd)\"" "$T/R2/home/.ft-env" && test -L "$T/R2/family-tree/research.json" \
  && ok "…its ~/.ft-env names that clone, and the links are in it" || no "R2 layout"
# a routine whose platform clones start on an older main than GitHub's, and whose origin/main the platform fetched
# shallow, so that the two histories do not meet (9 Nov 2026: "50 ahead, 50 behind", the private clone never pulled)
mkdir -p "$T/R3/home" && quiet git clone --depth 1 "file://$GHP" "$T/R3/family-tree-private" \
  && quiet git clone --depth 1 "file://$GHA" "$T/R3/family-tree-sources"
rm -rf "$T/r3p" "$T/r3a" && quiet git clone "file://$GHP" "$T/r3p" && quiet git clone "file://$GHA" "$T/r3a" \
  && mkdir -p "$T/r3p/_work/r3" "$T/r3a/archive/r3" && for i in 1 2 3; do
    echo "$i" >> "$T/r3p/_work/r3/NOTES.md" && git -C "$T/r3p" add -A && gnohook -C "$T/r3p" commit -qm "Save research notes"
    echo "$i" >> "$T/r3a/archive/r3/copy.md" && git -C "$T/r3a" add -A && gnohook -C "$T/r3a" commit -qm "Add a copy"; done \
  && quiet git -C "$T/r3p" push -q origin HEAD:main && quiet git -C "$T/r3a" push -q origin HEAD:main \
  && quiet git -C "$T/R3/family-tree-private" fetch -q --depth 1 origin main && quiet git -C "$T/R3/family-tree-sources" fetch -q --depth 1 origin main
test "$(git -C "$T/R3/family-tree-private" rev-list --count origin/main..HEAD)" = 1 \
  && ok "a routine's shallow clones can start on an older main whose history does not meet GitHub's" || no "R3: the stale clones"
check "…setup still runs" sh -c "cd '$T/R3' && HOME='$T/R3/home' FT_SITE_URL='file://$GHS' FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
test "$(git -C "$T/R3/family-tree-private" rev-parse HEAD)" = "$(gp rev-parse main)" && ok "…and brings the private clone up to GitHub's main" || no "R3: private clone not pulled"
test "$(git -C "$T/R3/family-tree-sources" rev-parse HEAD)" = "$(git --git-dir="$GHA" rev-parse main)" && ok "…and the source archive too" || no "R3: sources not pulled"
kq() { cloud K && work K; }
check "session K queues one more commit" kq
quiet cloud HH; quiet cloud W
quiet lock HH take "holder" "work"; mc HH h1
# W's take, held between its first look at the queue and its lock push, while the holder finishes
sed 's#^    why="$(qproblem)" \&\& refuse "$why"$#&; while [ ! -e "$HOME/go" ]; do sleep 0.2; done#' "$TOOLS/cloud-lock.sh" > "$TOOLS/cloud-lock-held.sh"
grep -q 'HOME/go' "$TOOLS/cloud-lock-held.sh" || no "the race harness could not hold the take"
( HOME="$T/W/home" bash "$TOOLS/cloud-lock-held.sh" take "waiter" "work" > "$T/w.out" 2>&1 ) & wpid=$!
sleep 2; quiet fin HH "Update working state" "holder"; touch "$T/W/home/go"; wait "$wpid"
grep -q "lock taken" "$T/w.out" && test "$(git -C "$T/W/family-tree" rev-parse HEAD)" = "$(gp rev-parse site-queue)" \
  && ok "a take that waited while the holder finished starts from what the holder queued" || { no "race: take after the holder finished"; sed 's/^/          /' "$T/w.out" | tail -5; }
quiet lock W release "waiter"
side l-side
refuse "a queue left behind by a direct push to public main is a QUEUE CONFLICT" cloud L
says "QUEUE CONFLICT" "…and names it"
refuse "…and the writer lock is refused in a session set up before" lock W take "waiter" "test"
says "QUEUE CONFLICT" "…naming it"
quiet cloud L2
check "a read-only session is not stopped by a QUEUE CONFLICT" sh -c "cd '$T/L2' && HOME='$T/L2/home' FT_READONLY=1 FT_SKIP_DECRYPT=1 FT_SKIP_TOOLS=1 bash '$TOOLS/cloud-setup.sh'"
mc K k2
refuse "a finish on the old queue stops on the conflict too" fin K "Update working state" "K"
says "not on top of the newest\|QUEUE CONFLICT" "…and says why"

echo "8. state split"
# the conflict resolved as OPERATING.md says: .public-head first, then the queue rebuilt on public main
quiet git -C "$PB" pull -q --ff-only && git --git-dir="$GHS" rev-parse main > "$PB/.public-head" && gnohook -C "$PB" commit -qam "Rebuild the site queue" \
  && quiet git -C "$PB" push -q origin HEAD:main
git --git-dir="$GHS" push -q -f "$GHP" main:refs/heads/site-queue
check "session X sets up once the queue is rebuilt" cloud X
quiet lock X take "x" "work"; mc X x1
touch "$T/queue-closed"
fin X "Update working state" "x" > "$T/last.out" 2>&1; rc=$?
[ "$rc" = 2 ] && grep -q "STATE SPLIT" "$T/last.out" && ok "a finish whose queue push fails stops with exit 2 (STATE SPLIT), the state pushed" || { no "exit 2 (got $rc)"; tail -5 "$T/last.out"; }
says 'The writer lock stays held by "x" meanwhile' "…and says the writer lock stays held, with the command for afterwards"
grep -q "before this machine is gone.$" "$T/last.out" && ! grep -q "gone. 2$" "$T/last.out" && ok "…its message ends cleanly" || no "exit 2 message"
refuse "setup on that same machine now stops: the commit .public-head names is not queued" cloud X
says "STATE SPLIT" "…and says so"
rm -f "$T/queue-closed"
check "the command finish printed repairs it" git -C "$T/X/family-tree" push -q "file://$GHP" HEAD:refs/heads/site-queue
check "…and setup is ready again" cloud X
quiet lock X release "x"
yq() { cloud Y && lock Y take "y" "work" && mc Y bad1 && fin Y "Update working state" "y"; }
check "session Y queues a commit" yq
verdict refused
xq="$(git -C "$T/X/family-tree" rev-parse HEAD)"          # the last good commit: the queue is rebuilt to it (OPERATING.md)
quiet git -C "$PB" pull -q --ff-only && echo "$xq" > "$PB/.public-head" && gnohook -C "$PB" commit -qam "Rebuild the site queue" && quiet git -C "$PB" push -q origin HEAD:main
gp update-ref refs/heads/site-queue "$xq"
mc Y good2
refuse "after a rebuild, a clone still holding the refused commit cannot finish" fin Y "Update working state" "y"
says "which the airlock refused" "…and says why"
refuse "…nor take the lock" lock Y take "y" "again"
says "which the airlock refused" "…naming it"
refuse "…nor set up again" cloud Y
says "which the airlock refused" "…naming it there too"
verdict checked
quiet git -C "$PB" pull -q --ff-only
echo 0123456789012345678901234567890123456789 > "$PB/.public-head"; gnohook -C "$PB" commit -qam "split" && quiet git -C "$PB" push -q origin HEAD:main
rm -rf "$T/C"; refuse "setup stops on a STATE SPLIT" cloud C
says 'STATE SPLIT' "…and names it"
refuse "a session that was ready stops at setup again" cloud B
test ! -e "$T/B/home/.ft-ready" && ok "…and is no longer marked ready" || no "ready mark kept after a stop"
refuse "after that stop, finish refuses" fin B "Update working state"
says "has not finished" "…and says why"
refuse "…and so does the lock" lock B take "session-b" "test"

echo "9. nothing real touched"
REAL_AFTER="$(real_state)"
if [ "$REAL_AFTER" = "$REAL_BEFORE" ]; then ok "the real clones on this machine and the real HOME's files are as they were (clones checked: $(printf '%s\n' "$REAL_BEFORE" | grep -c ' [0-9a-f]\{16\}$'))"
else no "the selftest changed something outside its folder:"; diff <(printf '%s\n' "$REAL_BEFORE") <(printf '%s\n' "$REAL_AFTER") | grep '^[<>]' | cut -c3- | cut -d' ' -f1 | sort -u | sed 's/^/          /'; fi

echo
if [ $failn = 0 ]; then rm -rf "$T"; echo "selftest: $pass ok, 0 failed"; else echo "selftest: $pass ok, $failn failed   (work folder kept: $T)"; fi
[ $failn = 0 ]
