#!/bin/bash
# shellcheck disable=SC2034
# Shared settings for the ec2mac/ scripts, the macOS half of the hardware panel.
# Kept apart from ec2/ so a run driven from there is never touched.
#
# EC2MAC_HOST picks the machine: mac1 (mac1.metal, Intel i7-8700B with UHD 630
# integrated graphics, $1.083/h) or mac2 (mac2.metal, Apple M1, $0.65/h).
# The unit of billing is the Dedicated Host, with a 24-hour minimum allocation
# before it can be released (see README.md).
#
# DRY_RUN=1 prints every AWS call that allocates, launches, changes or releases
# something instead of making it. Read-only describe calls still run.

REGION=${EC2_REGION:-us-east-1}
MACHOST=${EC2MAC_HOST:-}
case "$MACHOST" in
  mac1) INSTANCE_TYPE=mac1.metal ARCH=x86_64_mac RATE=1.083 ;;
  mac2) INSTANCE_TYPE=mac2.metal ARCH=arm64_mac RATE=0.65 ;;
  *) echo "EC2MAC_HOST must be mac1 or mac2, not '$MACHOST'" >&2; exit 2 ;;
esac
AZ=${EC2MAC_AZ:-us-east-1a}
KEY_NAME=jb2bench
KEY_FILE=$HOME/.ssh/jb2bench-ec2.pem
SG_NAME=jb2bench-ssh
MAX_MINUTES=${EC2MAC_MAX_MINUTES:-360}
BUILD=${EC2MAC_BUILD:-release-5.0.0-beta.20}

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CODE=$(dirname "$HERE")
PRIMARY=/home/cdiesh/src/jb2bench
# macOS reserves /home for the automounter, so the repo lives under the user's
# home and the build's absolute data symlinks are re-pointed after the copy.
REMOTE_USER=ec2-user
REMOTE_ROOT=/Users/ec2-user/jb2bench
STATE=$HERE/.state-$MACHOST
CORPUS=(20x.shortread.bam 20x.shortread.bam.bai 200x.shortread.bam 200x.shortread.bam.bai
  1000x.shortread.bam 1000x.shortread.bam.bai hg19mod.fa hg19mod.fa.fai)

aws() { command aws --region "$REGION" "$@"; }

mutate() {
  if [ "${DRY_RUN:-0}" = 1 ]; then
    printf 'DRY RUN: aws --region %s' "$REGION" >&2
    printf ' %q' "$@" >&2
    printf '\n' >&2
    echo "${PLACEHOLDER:-<dry-run>}"
    return 0
  fi
  aws "$@"
}

# The newest arm64 AMI is a macOS mac1's Intel hardware cannot run, so both
# hosts default to the newest build of one shared major version. Empty
# EC2MAC_MACOS takes the newest AMI of any version.
MACOS=${EC2MAC_MACOS-15}
latest_ami() {
  aws ec2 describe-images --owners amazon \
    --filters "Name=architecture,Values=$ARCH" "Name=name,Values=amzn-ec2-macos-${MACOS:+$MACOS.}*" 'Name=state,Values=available' \
    --query 'sort_by(Images,&CreationDate)[-1].[ImageId,Name,RootDeviceName]' --output text
}

load_state() {
  [ -f "$STATE" ] || { echo "no $MACHOST host: run ec2mac/up.sh first" >&2; exit 1; }
  # shellcheck source=/dev/null
  . "$STATE"
}

SSH_OPTS=(-i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=10)
# shellcheck disable=SC2029
remote() { ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$IP" "$@"; }
# Homebrew sits in /opt/homebrew on Apple silicon and /usr/local on Intel, and
# neither is on a non-login ssh session's PATH.
# shellcheck disable=SC2016
REMOTE_ENV='export PATH=/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH;'
RSYNC=(rsync -az -e "ssh ${SSH_OPTS[*]}" --rsync-path="PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH rsync")
