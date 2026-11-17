#!/bin/bash
# Daily log of every handle Kasper's account commented on / replied to.
# Usage:
#   x_log.sh check <handle>            -> prints OK or BLOCKED (exit 1 if blocked)
#   x_log.sh add <handle> <status_id> <type> <note...>   type = comment | reply | post
#   x_log.sh list                      -> today's log
# "Today" = Copenhagen date. One file per day in ../logs/.
DIR="$(cd "$(dirname "$0")/.." && pwd)/logs"
mkdir -p "$DIR"
DAY=$(TZ=Europe/Copenhagen date +%Y-%m-%d)
F="$DIR/comments-$DAY.txt"
touch "$F"
case "$1" in
  check)
    h="${2#@}"
    if grep -qiE "^[0-9:]+ comment ${h}( |$)" "$F"; then echo "BLOCKED $h (already commented today):"; grep -iE "^[0-9:]+ comment ${h}( |$)" "$F"; exit 1; fi
    echo "OK $h"; exit 0 ;;
  add)
    h="${2#@}"; id="$3"; type="$4"; shift 4
    [[ "$id" =~ ^[0-9]{15,20}$ ]] || { echo "BAD ID '$id'"; exit 2; }
    echo "$(TZ=Europe/Copenhagen date +%H:%M) $type $h $id $*" >> "$F"; echo "logged $type $h" ;;
  list) cat "$F" ;;
  *) echo "usage: x_log.sh check|add|list"; exit 2 ;;
esac
