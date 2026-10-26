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
# files the airlock does not publish, a message with a body, a payload the gate did not pass, more commits
# than the airlock takes, no writer lock or someone else's, a commit a queue rebuild dropped, other site
# work under this session's commits, a private push that meets the same lines: undone), the airlock's
# verdicts (refused blocks setup and the lock, a finish already under way still queues with a warning,
# published releases), direct publishing (only with an empty queue and the writer lock; live only when the site
# serves the commit's own page, not just its payload), a routine that
# clones the site itself or runs setup from inside its own clone, a QUEUE CONFLICT (setup and the lock
# stop), a read-only session (FT_READONLY=1) that neither stops on a blocked queue nor pushes, a finish that
# could not queue (exit 2: the same machine's setup then stops, and the printed command repairs it),
# setup's STATE SPLIT stop (after which the lock and finish refuse), and that nothing outside its folder changed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SEED="${1:?usage: cloud-selftest.sh <site clone>}"
T="$(mktemp -d /tmp/ft-selftest.XXXXXX)"
# the scripts under test run from a copy: from inside a site clone, cloud-setup.sh would use that clone
TOOLS="$T/tools-under-test"; mkdir -p "$TOOLS"
cp "$HERE"/cloud-lib.sh "$HERE"/cloud-setup.sh "$HERE"/cloud-verify.sh "$HERE"/cloud-lock.sh "$HERE"/cloud-finish.sh "$TOOLS"/
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
    && gnohook -C "$T/$1/family-tree" commit -qam "Update site data payload" && printf '%s\n' "$2" > "$T/$1/family-tree/.gate-stamp"
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
mkdir -p "$T/seed-src/archive" && ( cd "$T/seed-src" && git init -q -b main && echo "# index" > archive/INDEX.md && git add -A && gnohook commit -qm init )
quiet git clone --bare "$T/seed-src" "$GHA"
# the private repo as refresh.py builds it: its own files, the entries, .private-paths, MANIFEST.sha256
P0="$T/seed-priv"; mkdir -p "$P0"/ledger/history "$P0"/notes "$P0"/working/i18-plan "$P0"/sources "$P0"/evidence "$P0"/_work/go1 "$P0"/checks
( cd "$P0" && printf '{"investigations":[],"updated":"2026-10-17"}\n' > research.json && printf 'free\n' > ledger/LOCK \
  && : > ledger/changes.jsonl && : > ledger/register.jsonl && printf 'gz' > ledger/history/abc.json.gz \
  && echo note > notes/memory.md && echo 'print(1)' > working/i18-plan/a.py && echo '# open' > OPEN-ITEMS.md \
  && echo '# log' > CHANGE-LOG-COMMITS.md && echo '{}' > history.json && echo '[]' > checks/priority-cards.json \
  && echo '# notes' > _work/go1/NOTES.md && echo e > evidence/crop.txt && echo s > sources/urls.tsv \
  && echo '# private readme' > README.md && echo 'print("refresh")' > refresh.py && printf '* -text\n' > .gitattributes \
  && printf '.password\n/data.json\n' > .gitignore \
  && printf '%s\n' CHANGE-LOG-COMMITS.md OPEN-ITEMS.md _work checks/priority-cards.json evidence history.json ledger notes research.json sources working > .private-paths \
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
pc A AAAAAAAAAAAAAAA2; echo "AAAAAAAAAAAAAAA9" > "$A/.gate-stamp"
refuse "a payload the gate did not pass is refused" fin A "Update working state" "session-a"
says "not the one checks/gate.js last passed" "…and says why"
echo "AAAAAAAAAAAAAAA2" > "$A/.gate-stamp"
check "…and goes out once the gate has passed on it" fin A "Update working state" "session-a"
quiet lock A take "session-a" "many"
for i in $(seq 1 31); do mc A "n$i"; done
refuse "more commits than the airlock takes at once are refused" fin A "Update working state" "session-a"
says "at most 30" "…and says why"
git -C "$A" reset -q --hard HEAD~31; quiet lock A release "session-a"
echo "checkpoint" >> "$PA/_work/go1/NOTES.md"; echo "not yet" >> "$PA/OPEN-ITEMS.md"
check "the notes checkpoint pushes _work" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
gp show main:_work/go1/NOTES.md | grep -q checkpoint && ok "…GitHub has the notes" || no "notes not pushed"
if ! gp show main:OPEN-ITEMS.md | grep -q "not yet" && ! git -C "$PA" diff --quiet HEAD -- OPEN-ITEMS.md; then
  ok "…and nothing else: other private changes stay uncommitted here"; else no "notes took other files"; fi
gnohook -C "$PA" commit -qm "Update working state" -- OPEN-ITEMS.md
refuse "the checkpoint does not push other unpushed private commits" in_cloud A env FT_PUBLISH=notes bash "$TOOLS/cloud-finish.sh" "Save research notes"
says "not notes" "…and says why"
git -C "$PA" reset -q --hard origin/main
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
# the live check after a direct push: a page whose code changed and whose payload did not keeps its iv, so only
# the page's own bytes tell the new page from the old one (a local "site" serves whichever page is put in it)
mkdir -p "$T/www"; git --git-dir="$GHS" show main:index.html > "$T/www/index.html"
port=$(( 20000 + RANDOM % 20000 )); ( cd "$T/www" && exec python3 -m http.server --bind 127.0.0.1 "$port" ) >/dev/null 2>&1 & wwwpid=$!
sleep 1
codec() { # $1 = a comment: a commit of page code (the payload unchanged, so the gate's stamp still holds)
  echo "<!-- $1 -->" >> "$T/H/family-tree/index.html" && gnohook -C "$T/H/family-tree" commit -qam "Update page code" \
    && grep -o 'const ENC = {v:[0-9]*, iter:[0-9]*, salt:"[^"]*", iv:"[^"]*"' "$T/H/family-tree/index.html" | head -n 1 \
       | sed 's/.*iv:"//; s/"$//' > "$T/H/family-tree/.gate-stamp"
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
