#!/bin/bash
# Launch one GPU instance and wait until it answers ssh. Writes ec2/.state.
set -euo pipefail
. "$(dirname "$0")/config.sh"

if [ -f "$STATE" ]; then
  echo "ec2/.state exists; run ec2/down.sh first" >&2
  exit 1
fi

if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  [ -f "$KEY_FILE" ] && { echo "$KEY_FILE exists but $KEY_NAME is not registered in $REGION" >&2; exit 1; }
  aws ec2 create-key-pair --key-name "$KEY_NAME" --query KeyMaterial --output text >"$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC" \
  --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = None ]; then
  SG=$(aws ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC" \
    --description "ssh to jb2bench benchmark instances" --query GroupId --output text)
fi
MYIP=$(curl -fsS https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 \
  --cidr "$MYIP/32" >/dev/null 2>&1 || true

AMI=$(aws ssm get-parameter --name "$AMI_PARAM" --query Parameter.Value --output text)

ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" --security-group-ids "$SG" \
  --instance-initiated-shutdown-behavior terminate \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=100,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=jb2bench}]' \
  --user-data "$(printf '#!/bin/bash\nshutdown -h +%d\n' "$MAX_MINUTES")" \
  --query 'Instances[0].InstanceId' --output text)
echo "ID=$ID" >"$STATE"
echo "launched $ID ($INSTANCE_TYPE, $AMI) in $REGION; it powers off after $MAX_MINUTES min"

aws ec2 wait instance-running --instance-ids "$ID"
IP=$(aws ec2 describe-instances --instance-ids "$ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "IP=$IP" >>"$STATE"

for _ in $(seq 60); do
  remote true 2>/dev/null && { echo "ssh ubuntu@$IP ready"; exit 0; }
  sleep 5
done
echo "ssh never answered; ec2/down.sh terminates it" >&2
exit 1
