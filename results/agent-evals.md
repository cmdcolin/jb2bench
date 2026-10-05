# Agent evals

`scripts/agent-evals/run.ts` runs the jbrowse-components MCP eval (`products/jbrowse-desktop/test/mcpAgentEval.ts`):
one real `claude -p` session per task against JBrowse Desktop's MCP server, graded on the state of the JBrowse
session afterwards, never on the transcript. `make agent-evals SET=<dev|heldout|tutorials> CONFIG_DIR=<claude
config dir>`. Measured 2026-10-05 with Claude Code 2.1.289, `--model sonnet`, `--runs 3`.

| set | tasks | commit | passed | `run_javascript` errors | cost |
| --- | --- | --- | --- | --- | --- |
| dev | 26 | `8565ba708e` | 78 of 78 | 9 of 198 | $4.31 |
| heldout | 5 | `00a301b414` | 14 of 15 | 0 of 31 | $0.79 |
| tutorials | 2 | `00a301b414` | 2 of 6 | 10 of 69 | $2.23 |

**The held-out set is the score.** The documentation and the `jb` surface were tuned against the dev set, so its
perfect score says little. The held-out tasks are phrased apart from the documentation. The one failed held-out run
was `ho-count-variant-tracks`, which answered 16 where the catalog lists 15, with no errored call.

**The tutorial set is too small to report.** It has two tasks. In `tut-methylation-haplotypes` one run searched the
ONT Open Data bucket, loaded `giab_2025.01/.../SAMPLE.haplotagged.cram` and hit "compression method number 255"
(its `.crai` offsets are 63 bytes too high), and the other two runs failed the grader.

The summaries are `results/agent-evals-<set>.json`. They are copied from `~/agent-evals/<run>/summary.json`, where
the run directories hold the per-run transcripts.

## Running

The harness removes `CLAUDE_*` variables from the environment it spawns `claude` with, so `CONFIG_DIR` works through a
`claude` wrapper script placed first on `PATH`. If the default account has hit its usage limit, `claude -p` answers
with the limit message and the eval stops rather than record a failure; point `CONFIG_DIR` at another account.
Needs `xvfb-run`, `claude` on `PATH`, and a built Desktop (`pnpm --filter @jbrowse/desktop build`).
