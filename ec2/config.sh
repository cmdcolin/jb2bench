# Shared settings for the ec2/ scripts. Every one of them sources this.
#
# us-east-1 because it is the region this account has a GPU quota in:
# us-east-2 and us-west-2 grant 0 vCPUs of G instances, on demand and spot.
# The instance serves the corpus to itself, so the region never enters a timing.

REGION=${EC2_REGION:-us-east-1}
INSTANCE_TYPE=${EC2_TYPE:-g4dn.xlarge}
AMI_PARAM=/aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id
KEY_NAME=jb2bench
KEY_FILE=$HOME/.ssh/jb2bench-ec2.pem
SG_NAME=jb2bench-ssh
# The instance powers itself off after this long whatever happens here, and
# powering off terminates it, so a lost laptop or a killed script cannot leave
# a GPU billing overnight.
MAX_MINUTES=${EC2_MAX_MINUTES:-240}

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CODE=$(dirname "$HERE")
# builds/ and data/ are untracked, so they exist only in the primary checkout.
PRIMARY=/home/cdiesh/src/jb2bench
# The builds reach the corpus through absolute symlinks into $PRIMARY/data, so
# the instance keeps the repo at the same path.
REMOTE_ROOT=$PRIMARY
STATE=$HERE/.state

aws() { command aws --region "$REGION" "$@"; }

load_state() {
  [ -f "$STATE" ] || { echo "no instance: run ec2/up.sh first" >&2; exit 1; }
  # shellcheck source=/dev/null
  . "$STATE"
}

SSH_OPTS=(-i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=10)
remote() { ssh "${SSH_OPTS[@]}" "ubuntu@$IP" "$@"; }
