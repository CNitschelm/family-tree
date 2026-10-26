#!/usr/bin/env bash
# cloud-nettest.sh — what this cloud environment can reach, tested with an honest client: curl's own
# identity, never a browser user-agent. Read-only: it downloads a few small things and pushes nothing
# (the GitHub checks are dry runs).
#
#   bash cloud-nettest.sh        (after cloud-setup.sh)
#
# Exit 0 when everything the work needs is reachable and the environment's allowlist is in force.
# A host the environment blocks shows as "blocked here" (the session's proxy refused the connection);
# a site that refuses cloud servers shows its own answer (403, 503, a redirect to a sign-in page).

set -uo pipefail
[ -f "$HOME/.ft-env" ] && . "$HOME/.ft-env"
FT="${FT_DIR:?run cloud-setup.sh first}"; PRIV="${FT_PRIVATE_DIR:?}"; SRC="${FT_ARCHIVE:?}"
T="$(mktemp -d)"; nfail=0
iv_of() { grep -o 'const ENC = {v:[0-9]*, iter:[0-9]*, salt:"[^"]*", iv:"[^"]*"' "$1" 2>/dev/null | head -n 1 | sed 's/.*iv:"//; s/"$//'; }
probe() { # $1 = need | may-refuse | must-block, $2 = label, $3 = url, [$4 = byte range]
  local exp="$1" label="$2" url="$3" range="${4:-}" out code conn type size secs v
  out=$(curl -sS -o "$T/body" -w '%{http_code}|%{http_connect}|%{content_type}|%{size_download}|%{time_total}' \
        --max-time 30 ${range:+-r "$range"} "$url" 2>"$T/err") || true
  IFS='|' read -r code conn type size secs <<<"${out:-000|000|-|0|0}"
  local blocked=0; [ "$code" = 000 ] && case "$conn" in 403|407) blocked=1 ;; esac
  case "$exp" in
    need)
      if [ $blocked = 1 ]; then v="FAIL: blocked here (not on the environment's list?)"; nfail=$((nfail+1))
      else case "$code" in 200|206) v=ok ;; *) v="FAIL: the site answered $code"; nfail=$((nfail+1)) ;; esac; fi ;;
    may-refuse)
      if [ $blocked = 1 ]; then v="FAIL: blocked here, though it is on the list"; nfail=$((nfail+1))
      else case "$code" in 200|206) v=ok ;; 30?) v="redirects (sign-in or another page)" ;; 000) v="no answer" ;; *) v="refused by the site ($code)" ;; esac; fi ;;
    must-block)
      if [ $blocked = 1 ]; then v="blocked here, as it should be"
      else case "$code" in 000) v="not reached, as it should be" ;; *) v="FAIL: reachable ($code), so the list is not in force"; nfail=$((nfail+1)) ;; esac; fi ;;
  esac
  local host="${url#https://}"; host="${host%%/*}"
  case ",${NO_PROXY:-${no_proxy:-}}," in *",$host,"*|*",.${host#*.},"*) v="$v (bypasses the proxy, so not a test of the list)" ;; esac
  printf '%-30s %-4s %-17s %9s B %6.2fs  %s\n' "$label" "$code" "${type%%;*}" "${size:-0}" "${secs:-0}" "$v"
  if [ "$code" = 000 ] && [ $blocked = 0 ]; then sed -n '1p' "$T/err" | cut -c1-140 | sed 's/^/      curl: /'; fi
}
echo "client: $(curl --version | head -1 | cut -d' ' -f1-2), with curl's own user-agent"
printf '%-30s %-4s %-17s %11s %7s  %s\n' "what" "http" "type" "bytes" "time" "verdict"
probe need       "live site"                  "https://family.corynitschelm.com/"
want=$(iv_of "$FT/index.html"); got=$(iv_of "$T/body")
if [ -n "$want" ] && [ "$got" = "$want" ]; then echo "      the live payload is origin/main's (iv $want)"; else echo "      NOTE: live iv '${got:-none}', origin/main's '${want:-none}'"; fi
probe need       "archives68 page image"      "https://archives68.alsace.eu/images/95f47ab6-8c05-472e-8e5f-b4621a5a8234.jpg"
probe need       "archives68 viewer data"     "https://archives68.alsace.eu/visualizer/api?arkName=02pgjf4hqlds&uuid=95f47ab6-8c05-472e-8e5f-b4621a5a8234"
probe may-refuse "archives67 viewer page"     "https://archives67.alsace.eu/ark:/78665/2158006/dao/0/153"
probe need       "Munster index (first 1 kB)" "https://wp.fgha.fr/wp-content/uploads/2016/10/MUNSTER.pdf" "0-1023"
probe need       "Open Archives API"          "https://api.openarch.nl/1.0/records/search.json?name=test&number_show=1"
probe need       "French death index"         "https://deces.matchid.io/"
probe need       "Wikipedia"                  "https://en.wikipedia.org/wiki/Alsace"
probe need       "GitHub status"              "https://www.githubstatus.com/api/v2/status.json"
probe may-refuse "FamilySearch"               "https://www.familysearch.org/"
probe may-refuse "Find a Grave"               "https://www.findagrave.com/"
# record sites the environment's list has let through since 25 Oct 2026 (decisions-page item yc22; tested 26 Oct)
probe need       "Wikimedia Commons"          "https://commons.wikimedia.org/wiki/Main_Page"
probe need       "Filae"                      "https://www.filae.com/"
probe need       "RetroNews"                  "https://www.retronews.fr/"
probe may-refuse "MyHeritage"                 "https://www.myheritage.com/research"
probe need       "npm registry"               "https://registry.npmjs.org/"
probe need       "PyPI"                       "https://pypi.org/simple/pip/"
probe must-block "a host not on the list"     "https://example.com/"

echo
echo "GitHub (through the session's GitHub proxy; the push checks are dry runs, nothing is sent):"
for r in "$FT" "$PRIV" "$SRC"; do
  name=$(basename "$r")
  if git -C "$r" ls-remote -q origin HEAD >/dev/null 2>"$T/err"; then rd=ok; else rd="FAIL: $(head -1 "$T/err" | cut -c1-80)"; nfail=$((nfail+1)); fi
  if git -C "$r" push --dry-run -q origin HEAD:refs/heads/main >/dev/null 2>"$T/err"; then pw="ok (dry run)"; else pw="FAIL: $(grep -v '^hint' "$T/err" | head -1 | cut -c1-80)"; nfail=$((nfail+1)); fi
  printf '  %-22s read %-6s push %s\n' "$name" "$rd" "$pw"
done
rm -rf "$T"
echo; [ $nfail = 0 ] && echo "NETTEST: PASS" || echo "NETTEST: $nfail FAIL"
[ $nfail = 0 ]
