# Agent evals

`scripts/agent-evals/run.ts` runs the jbrowse-components MCP eval (`products/jbrowse-desktop/test/mcpAgentEval.ts`):
one real `claude -p` session per task against JBrowse Desktop's MCP server, graded on the state of the JBrowse
session afterwards, never on the transcript. `make agent-evals SET=<dev|heldout|tutorials> CONFIG_DIR=<claude
config dir>`. Measured 2026-10-05 with Claude Code 2.1.289, `--model sonnet`, `--runs 3`.

| set | tasks | commit | passed | `run_javascript` errors | cost |
| --- | --- | --- | --- | --- | --- |
| dev | 26 | `8565ba708e` | 78 of 78 | 9 of 198 | $4.31 |
| heldout | 5 | `231c700ddf` | 13 of 15 | 10 of 52 | $1.06 |
| tutorials | 2 | `00a301b414` | 2 of 6 | 10 of 69 | $2.23 |

**The held-out set is the score.** The documentation and the `jb` surface were tuned against the dev set, so its
perfect score says little. The held-out tasks are phrased apart from the documentation. The table's held-out row is
the run of record, scored by the corrected grader described below.

**The `ho-count-variant-tracks` grader changed after the first runs.** It counted tracks whose `assemblyNames`
include `volvox`, which gives 15 and leaves out `volvox_filtered_vcf_assembly_alias`, registered under `vvx`, an alias
of `volvox`. It now resolves each track's assembly through the assembly manager, which gives 16
(`jbrowse-components` `231c700ddf`). The prompt is unchanged. The agent answers 15 or 16 from run to run (5 of 9 runs
said 16), so the prompt reads two ways and the task separates a counting choice, not a skill.

| held-out run | commit | answer counts | old grader | corrected grader |
| --- | --- | --- | --- | --- |
| first (`results/agent-evals-heldout-first-old-grader.json`) | `00a301b414` | 15, 15, 16 | 14 of 15 | 13 of 15 |
| rerun (`results/agent-evals-heldout-rerun.json`) | `fa980d301f` | 16, 16, 16 | 12 of 15 | 15 of 15 |
| corrected (`results/agent-evals-heldout.json`) | `231c700ddf` | 16, 15, 15 | | 13 of 15 |

The first two rows were scored by the old grader when run. Their corrected-grader columns come from regrading the saved
answers by hand, because the harness cannot regrade a saved session. Every other held-out task passed all runs in
all three.

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
