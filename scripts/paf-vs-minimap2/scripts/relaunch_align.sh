#!/usr/bin/env bash
# Stop any earlier alignment chain (matched by pid, not by the caller's command line) and start align_all.sh in the background.
cd "$(dirname "$0")/.."
for pat in "run_fetch_align.sh" "scripts/align_all.sh" "minimap2 -t"; do
  for pid in $(pgrep -u "$USER" -f "$pat"); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done
done
sleep 2
ps -o pid,etime,args -u "$USER" | grep -E "minimap2 -t|align_all" | grep -v grep || echo "nothing running"
rm -f mm2/*.part mm2/*.log
[ -f fetch_align.log ] && mv fetch_align.log fetch.log
sed -i "s/ulimit -v 16000000/ulimit -v 24000000/" scripts/align_all.sh
nohup bash scripts/align_all.sh > align.log 2>&1 &
sleep 5
cat align.log
ps -o pid,etime,rss,args -u "$USER" | grep "minimap2 -t 2" | grep -v grep | cut -c1-120
free -g | head -2
date
