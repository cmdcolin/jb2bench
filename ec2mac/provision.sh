#!/bin/bash
# Install node, rsync and the puppeteer-pinned Chrome for Testing on the Mac,
# then copy the code, the build under test and the three BAMs the panel reads.
# Safe to rerun: rsync sends only what changed.
set -euo pipefail
. "$(dirname "$0")/config.sh"
load_state

remote "bash -s" <<REMOTE
set -euo pipefail
$REMOTE_ENV
command -v brew >/dev/null || { echo "no Homebrew on this AMI" >&2; exit 1; }
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1
brew list node@24 >/dev/null 2>&1 || brew install node@24
brew list rsync >/dev/null 2>&1 || brew install rsync
corepack enable
# Spotlight indexing the corpus and the Chrome download would run beside the timings.
sudo mdutil -a -i off >/dev/null || true
mkdir -p $REMOTE_ROOT/builds/$BUILD $REMOTE_ROOT/data
node --version; sw_vers -productVersion; sysctl -n machdep.cpu.brand_string
system_profiler SPDisplaysDataType | grep -E 'Chipset Model|Metal' || true
REMOTE

"${RSYNC[@]}" --delete \
  --exclude .git --exclude /.claude --exclude node_modules --exclude /data \
  --exclude /builds --exclude /results --exclude /flame --exclude /screenshots \
  --exclude /crosstool --exclude '/ec2/.state' --exclude '/ec2mac/.state-*' \
  "$CODE/" "$REMOTE_USER@$IP:$REMOTE_ROOT/"

"${RSYNC[@]}" "$PRIMARY/builds/$BUILD/" "$REMOTE_USER@$IP:$REMOTE_ROOT/builds/$BUILD/"
"${RSYNC[@]}" --files-from=<(printf '%s\n' "${CORPUS[@]}") "$PRIMARY/data/" "$REMOTE_USER@$IP:$REMOTE_ROOT/data/"

# The build's corpus files are absolute symlinks into $PRIMARY/data, which
# cannot exist on macOS; point them at the copied data instead.
remote "cd $REMOTE_ROOT/builds/$BUILD && for l in *; do
  t=\$(readlink \"\$l\" || true)
  case \$t in $PRIMARY/data/*) ln -sfn \"$REMOTE_ROOT/data/\${t##*/}\" \"\$l\" ;; esac
done && ls -lL ${CORPUS[*]:0:1} >/dev/null"

remote "$REMOTE_ENV cd $REMOTE_ROOT && pnpm install --frozen-lockfile >/dev/null && npx puppeteer browsers install chrome && echo provisioned"
