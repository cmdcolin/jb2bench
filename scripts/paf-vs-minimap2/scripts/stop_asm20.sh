#!/usr/bin/env bash
# Stop the whole-contig asm20 jobs and the xargs runner, leaving the asm5 job,
# the count and the genome-wide run alone. Shell parents die first so no
# partial output is renamed into place.
cd "$(dirname "$0")/.."
for pat in "scripts/align_all.sh" "xargs -P 6" 'bash -c one'; do
  for pid in $(pgrep -u "$USER" -f "$pat"); do
    if [ "$pid" != "$$" ] && ! ps -o args= -p "$pid" | grep -q asm5; then
      kill "$pid" 2>/dev/null
    fi
  done
done
sleep 1
for pid in $(pgrep -u "$USER" -f "cx asm20"); do kill "$pid" 2>/dev/null; done
sleep 2
rm -f mm2/*.asm20.paf.part
ps -o pid,etime,rss,args -u "$USER" | grep -E "minimap[2]|bash -c on[e]|xarg[s]|align_al[l]" | cut -c1-110
free -g | head -2
