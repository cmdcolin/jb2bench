#!/bin/bash
# Sourced by run.sh and cpusweep.sh after their config: start ec2mac/drive.sh
# detached on the machine, or attach to one already running, and pull its
# results back every SYNC_SECONDS until it marks itself finished. A dropped
# connection costs nothing: rerun the same target and it reattaches.
#
# Needs remote, RSYNC, REMOTE_USER, IP and REMOTE_ROOT from the caller, and
# DRIVE_ENV, the variable assignments drive.sh runs under.

DRIVER="pgrep -f '[e]c2mac/drive.sh' >/dev/null"

start_or_attach() {
  local label=$1
  if remote "$DRIVER"; then
    echo "a panel driver is already running on $IP; attaching"
  else
    local runid
    runid=$label-$(date -u +%Y%m%d-%H%M)
    # results/ must exist before the redirect into it, and the finished marker
    # must go before the driver starts or the first poll reads the last run's.
    remote "$REMOTE_ENV cd $REMOTE_ROOT || exit 1
      mkdir -p results/.ec2mac && rm -f results/.ec2mac/finished results/.ec2mac/panel.done
      echo $runid >results/.ec2mac/runid
      \$(command -v setsid) nohup env $DRIVE_ENV OUT=results/ec2mac/$runid LABEL=$label ec2mac/drive.sh \
        >results/ec2mac-run.log 2>&1 </dev/null &"
  fi
}

sync_until_finished() {
  local runid out
  runid=$(remote "cat $REMOTE_ROOT/results/.ec2mac/runid")
  out=$CODE/results/ec2mac/$runid
  mkdir -p "$out"
  echo "results: $out"
  local src="$REMOTE_USER@$IP:$REMOTE_ROOT"
  until remote "test -f $REMOTE_ROOT/results/.ec2mac/finished && ! $DRIVER"; do
    sleep "${SYNC_SECONDS:-300}"
    "${RSYNC[@]}" "$src/results/ec2mac/$runid/" "$out/" || true
    "${RSYNC[@]}" "$src/results/ec2mac-run.log" "$out/run.log" || true
    remote "tail -n 2 $REMOTE_ROOT/results/ec2mac-run.log; uptime" || true
  done
  "${RSYNC[@]}" "$src/results/ec2mac/$runid/" "$out/"
  "${RSYNC[@]}" "$src/results/ec2mac-run.log" "$out/run.log"
  remote "cat $REMOTE_ROOT/results/.ec2mac/panel.done"
  [ -f "$out/panel.md" ] && cat "$out/panel.md"
  echo "results in $out"
}
