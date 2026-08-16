# Parser-library benchmarks: the versions JBrowse 2 shipped in 2023 against the
# current releases, on the same corpus the render benchmarks use.
#
#   make bench     setup + equivalence gate + timings + results/ecosystem.md
#
# `bench` depends on `verify` on purpose: a timing comparison between two
# libraries that return different records is not a comparison, so the gate runs
# first and a failure stops the run.

.PHONY: all bench setup setup-sweep install typecheck verify time report scan gff3 sweep cohort clean distclean

all: bench

node_modules:
	pnpm install --ignore-workspace

install: node_modules

.libs/manifest.txt: versions.json setup.sh
	./setup.sh

setup: .libs/manifest.txt

# Runs before the gate: vitest strips types without checking them, so a broken
# import here is otherwise only discovered minutes into a run, as a runtime
# ENOENT on a path that reads `undefined...`.
typecheck: install
	pnpm exec tsc --noEmit -p tsconfig.json

verify: install setup typecheck
	pnpm exec vitest run equivalence.test.ts

time: install setup
	pnpm exec vitest bench --run

report:
	node --experimental-strip-types report.ts

# The @gmod/vcf v7.1.1 -> v7.2.0 genotype-scan before/after, kept out of `time`
# because it needs one process per side. vitest runs both sides of a comparison
# in one V8, which is fine for the 6x-45x gaps `time` measures and wrong for a
# few percent: in-process, one case reported a regression that process isolation
# shows to be a 1.09x gain. See the header of scan.ts.
scan: install setup
	node --experimental-strip-types scan.ts

# gff-nostream eager vs lazy attribute parsing. Out of `time` for the same
# reason `scan` is, and more so: the eager parser's garbage is still on the heap
# when the lazy arm runs, so sharing a process charges the lazy arm for it. In
# one process this comparison reported 9.6x where process isolation says 2.2x.
# Needs no cloned builds — both arms call different functions of the installed
# release — but it does need ../shell/generate_gff3.sh to have run.
gff3: install
	node --experimental-strip-types gff3-lazy.ts

# Every major line of @gmod/bam, @gmod/cram and @gmod/bbi, rather than the two
# points versions.json compares. Out of `bench` because it needs its own 30-odd
# library builds and answers a different question: not how much faster the
# parsers got, but where along the way it happened. One process per version, for
# the reason `scan` is one process per side — and more so, since a sweep loads N
# builds into one V8 rather than two.
.libs/sweep-manifest.txt: sweep.json setup-sweep.sh
	./setup-sweep.sh

setup-sweep: .libs/sweep-manifest.txt

sweep: install setup-sweep
	node --experimental-strip-types sweep.ts

# The 100-BigWig cohort panel. Reports request counts, which are exact and need
# no idle machine, alongside timings, which do. Needs the corpus:
# ../shell/generate_cohort_bw.sh
cohort: install
	node --experimental-strip-types cohort-bw.ts

bench: verify time report

clean:
	rm -rf results

# also drops the eight cloned library builds, which take a few minutes to rebuild
distclean: clean
	rm -rf .libs node_modules
