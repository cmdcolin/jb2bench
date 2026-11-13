#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/fetch_all.sh "HG01109#1#JAHEPA020000055.1" "HG01123#1#CM089081.1" "HG01960#1#CM088644.1" "HG02055#1#CM092205.1" \
  "HG00097#1#CM094060.1" "HG00099#1#JBHDWO010000059.1" "HG00128#1#JBHIKS010000054.1" "HG00133#1#CM090045.1"
bash scripts/align_all.sh
