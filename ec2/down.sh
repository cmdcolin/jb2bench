#!/bin/bash
# Terminate the instance ec2/.state names and forget it.
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state
aws ec2 terminate-instances --instance-ids "$ID" >/dev/null
aws ec2 wait instance-terminated --instance-ids "$ID"
rm -f "$STATE"
echo "terminated $ID"
