#!/bin/bash
# Terminate the Mac instance, then release its Dedicated Host. The host bills
# from allocation until release, so terminating alone does not stop the meter,
# and AWS refuses the release until 24 h after allocation. Rerun this after that
# point; it keeps the state file until the host is gone.
#
#   EC2MAC_HOST=mac2 ec2mac/down.sh
#   EC2MAC_HOST=mac2 DRY_RUN=1 ec2mac/down.sh
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state

if [ -n "${ID:-}" ]; then
  mutate ec2 terminate-instances --instance-ids "$ID" >/dev/null
  if [ "${DRY_RUN:-0}" != 1 ]; then
    aws ec2 wait instance-terminated --instance-ids "$ID"
    sed -i.bak '/^ID=/d;/^IP=/d' "$STATE" && rm -f "$STATE.bak"
    echo "terminated $ID"
  fi
fi

EARLIEST=$(date -u -d "$ALLOCATED_AT + 24 hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -j -v+24H -f %Y-%m-%dT%H:%M:%SZ "$ALLOCATED_AT" +%Y-%m-%dT%H:%M:%SZ)
if [ "${DRY_RUN:-0}" = 1 ]; then
  mutate ec2 release-hosts --host-ids "$HOST_ID" >/dev/null
  echo "DRY RUN: nothing terminated or released"
else
  FAILED=$(aws ec2 release-hosts --host-ids "$HOST_ID" --query 'Unsuccessful[].Error.Message' --output text 2>&1 || true)
  if [ -z "$FAILED" ] || [ "$FAILED" = None ]; then
    rm -f "$STATE"
    echo "released $HOST_ID; billing for it has stopped"
    exit 0
  fi
  echo "host $HOST_ID NOT released: $FAILED"
fi
echo
echo "REMINDER: dedicated host $HOST_ID ($INSTANCE_TYPE) bills \$$RATE/h from $ALLOCATED_AT until it is released."
echo "          Billing pauses only while the host is scrubbing after termination."
echo "          The earliest release is $EARLIEST. Then run: make mac-down HOST=$MACHOST CONFIRM=1"
echo "          Check: aws --region $REGION ec2 describe-hosts --host-ids $HOST_ID --query 'Hosts[0].State'"
