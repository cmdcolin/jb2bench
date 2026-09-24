#!/bin/bash
# Install what the harness needs on a fresh instance, then copy the code, the
# builds and the corpus files a run reads. Safe to rerun: rsync sends only what
# changed.
#
#   ec2/provision.sh                 the files the spike reads
#   EC2_CORPUS=full ec2/provision.sh the whole paper matrix
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state

remote 'bash -s' <<'EOF'
set -euo pipefail
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q nodejs rsync \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 fonts-liberation libvulkan1 vulkan-tools \
    libegl1 mesa-utils >/dev/null
  sudo corepack enable
fi
sudo mkdir -p /home/cdiesh/src
sudo chown ubuntu:ubuntu /home/cdiesh /home/cdiesh/src
mkdir -p /home/cdiesh/src/jb2bench/builds /home/cdiesh/src/jb2bench/data
EOF

RS=(rsync -az --info=stats1 -e "ssh ${SSH_OPTS[*]}")

"${RS[@]}" --delete \
  --exclude .git --exclude /.claude --exclude node_modules --exclude /data \
  --exclude /builds --exclude /results --exclude /flame --exclude /screenshots \
  --exclude /ec2/.state --exclude /crosstool \
  "$CODE/" "ubuntu@$IP:$REMOTE_ROOT/"

# crosstool/ carries untracked tool bundles and a relative data symlink, so it
# comes from the primary checkout as it stands.
"${RS[@]}" "$PRIMARY/crosstool/" "ubuntu@$IP:$REMOTE_ROOT/crosstool/"

# Symlinks are copied as symlinks: they point at $PRIMARY/data, which is the
# same path on the instance.
for b in ${EC2_BUILD:-current} release-4.3.0 release-2.4.0; do
  "${RS[@]}" "$PRIMARY/builds/$b/" "ubuntu@$IP:$REMOTE_ROOT/builds/$b/"
done

if [ "${EC2_CORPUS:-spike}" = full ]; then
  "${RS[@]}" --include '*.bam' --include '*.bai' --include '*.cram' --include '*.crai' \
    --include '*.fa' --include '*.fai' --include '*.sizes' --exclude '*' \
    "$PRIMARY/data/" "ubuntu@$IP:$REMOTE_ROOT/data/"
else
  "${RS[@]}" --files-from=<(cd "$PRIMARY/data" && ls -1 \
    20x.shortread.* 200x.shortread.* 20x.longread.* hg19mod.fa* hg19_17.chrom.sizes 2>/dev/null) \
    "$PRIMARY/data/" "ubuntu@$IP:$REMOTE_ROOT/data/"
fi

remote "cd $REMOTE_ROOT && pnpm install --frozen-lockfile >/dev/null && npx puppeteer browsers install chrome >/dev/null && echo provisioned"
