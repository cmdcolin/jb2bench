#!/bin/bash
# Allocate one Mac Dedicated Host, launch the latest macOS AMI on it, and wait
# until it answers ssh (6-20 minutes per AWS). Writes ec2mac/.state-<host>.
#
#   EC2MAC_HOST=mac2 ec2mac/up.sh            spends money: 24 h minimum
#   EC2MAC_HOST=mac2 DRY_RUN=1 ec2mac/up.sh  prints the AWS calls instead
#   EC2MAC_AMI=ami-... overrides the AMI lookup
set -euo pipefail
. "$(dirname "$0")/config.sh"

if [ -f "$STATE" ] && [ "${DRY_RUN:-0}" != 1 ]; then
  echo "$STATE exists; run ec2mac/down.sh first" >&2
  exit 1
fi

if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "key pair $KEY_NAME is not registered in $REGION; ec2/up.sh creates it" >&2
  exit 1
fi
[ -f "$KEY_FILE" ] || { echo "$KEY_FILE missing" >&2; exit 1; }

VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = None ]; then
  SG=$(PLACEHOLDER='<new-sg>' mutate ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC" \
    --description "ssh to jb2bench benchmark instances" --query GroupId --output text)
fi
MYIP=$(curl -fsS https://checkip.amazonaws.com)
mutate ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 \
  --cidr "$MYIP/32" >/dev/null 2>&1 || true

if [ -n "${EC2MAC_AMI:-}" ]; then
  read -r AMI AMI_NAME ROOT_DEV < <(aws ec2 describe-images --image-ids "$EC2MAC_AMI" \
    --query 'Images[0].[ImageId,Name,RootDeviceName]' --output text)
else
  read -r AMI AMI_NAME ROOT_DEV < <(latest_ami)
fi
echo "$MACHOST: $INSTANCE_TYPE in $AZ, $AMI ($AMI_NAME), root $ROOT_DEV"

ALLOCATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HOST_ID=$(PLACEHOLDER='<host-id>' mutate ec2 allocate-hosts --instance-type "$INSTANCE_TYPE" \
  --availability-zone "$AZ" --quantity 1 --auto-placement off \
  --tag-specifications 'ResourceType=dedicated-host,Tags=[{Key=Name,Value=jb2bench-mac}]' \
  --query 'HostIds[0]' --output text)
if [ "${DRY_RUN:-0}" != 1 ]; then
  printf 'HOST_ID=%s\nALLOCATED_AT=%s\n' "$HOST_ID" "$ALLOCATED_AT" >"$STATE"
  echo "allocated $HOST_ID at $ALLOCATED_AT: it bills \$$RATE/h until released, and cannot be released for 24 h"
fi

ID=$(PLACEHOLDER='<instance-id>' mutate ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --placement "HostId=$HOST_ID,Tenancy=host" \
  --key-name "$KEY_NAME" --security-group-ids "$SG" \
  --instance-initiated-shutdown-behavior terminate \
  --block-device-mappings "DeviceName=$ROOT_DEV,Ebs={VolumeSize=150,VolumeType=gp3,DeleteOnTermination=true}" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=jb2bench-mac}]' \
  --user-data "$(printf '#!/bin/bash\nshutdown -h +%d\n' "$MAX_MINUTES")" \
  --query 'Instances[0].InstanceId' --output text)
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "DRY RUN: then wait for instance-running and ssh $REMOTE_USER@<ip> (up to 40 min); nothing was allocated"
  exit 0
fi
echo "ID=$ID" >>"$STATE"
echo "launched $ID; it powers off after $MAX_MINUTES min, which terminates the instance but NOT the host"

aws ec2 wait instance-running --instance-ids "$ID"
IP=$(aws ec2 describe-instances --instance-ids "$ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "IP=$IP" >>"$STATE"

for _ in $(seq 240); do
  remote true 2>/dev/null && { echo "ssh $REMOTE_USER@$IP ready"; exit 0; }
  sleep 10
done
echo "ssh never answered in 40 min; ec2mac/down.sh terminates it and releases the host once 24 h have passed" >&2
exit 1
