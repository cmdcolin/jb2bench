# Parser-library benchmarks: the versions JBrowse 2 shipped in 2023 against the
# current releases, on the same corpus the render benchmarks use.
#
#   make bench     setup + equivalence gate + timings + results/ecosystem.md
#
# `bench` depends on `verify` on purpose: a timing comparison between two
# libraries that return different records is not a comparison, so the gate runs
# first and a failure stops the run.

.PHONY: all bench setup install verify time report clean distclean

all: bench

node_modules:
	pnpm install --ignore-workspace

install: node_modules

.libs/manifest.txt: versions.json setup.sh
	./setup.sh

setup: .libs/manifest.txt

verify: install setup
	pnpm exec vitest run equivalence.test.ts

time: install setup
	pnpm exec vitest bench --run

report:
	node --experimental-strip-types report.ts

bench: verify time report

clean:
	rm -rf results

# also drops the eight cloned library builds, which take a few minutes to rebuild
distclean: clean
	rm -rf .libs node_modules
