# Review portals

`scripts/portals/` times the two static review portals JBrowse builds from `@jbrowse/img` and `@jbrowse/capture`
(`make portals-variant`, `make portals-gene`). Measured 2026-10-05.

## Structural variant portal

COLO829 somatic callset, 135 records; `jb2export batch` renders one image per record from the tumor ONT CRAM and
from the matched normal ONT BAM, then `variant-review-portal` builds the page. `@jbrowse/img` 5.0.0-beta.11,
`variant-review-portal` at `02aa0f1`.

| source | machine | tumor | matched normal | page build |
| --- | --- | --- | --- | --- |
| local disk | i9-12900K, 24 cores | 26 s cold, 12 s warm | 17 s cold, 16 s warm | 0.4 s |
| ONT S3 bucket | i9-9880H, 16 threads | 74 s, 90 s | 395 s | 0.3 s |

Every local run rendered 135 of 135 images. The second run over the network rendered 134 of 135, and the failed
record was chr7 record 51. Over the network CPU use stayed at 18–59% with ingress near 14–20 MB/s; on local disk the
tumor run used 3–6 cores and the normal run about 10, so the local runs are bound by the renderer. The 26 s cold tumor
run was the first read after the download. `variant.ts --evict` drops the file with `posix_fadvise(DONTNEED)`, which
evicts less than a 180 GB download does: the rerun from this repo on ada took 12.3 s cold and 11.9 s warm for the
tumor, 15.9 s and 15.3 s for the normal, and 0.3 s for the page, all 135 of 135.

The inputs are 78.8 GB of tumor CRAM and 179 GB of normal BAM, 242 GiB with the reference and indexes
(`scripts/portals/fetch-colo829.sh`). `scripts/portals/localconfig.ts` rewrites the demo config
(`jbrowse.org/demos/cancer_sv/config.json`) to `LocalPathLocation` entries; a bare absolute path in `uri` becomes an
`http://localhost` URL and fails.

## Gene portal

Tiberius predictions for chr22 against GENCODE v49, with two RNA-seq BAMs. 559 models, 135 flagged, 28 cards kept at
the default cap of 12 per class. `gene-review-portal` at `ea77ec5`, `@jbrowse/capture` 5.0.0-beta.8, a local
5.0.0-beta.11 `jbrowse-web` build passed as `--app-dir`.

| source | machine | wall | screenshots | per screenshot | without screenshots |
| --- | --- | --- | --- | --- | --- |
| local disk | i9-12900K, 24 cores | 93–98 s, six runs | 28 | 3.3–3.5 s | 5 s |
| local disk | i9-9880H, 16 threads | 130 s, 165 s | 28 | 4.6–5.9 s | 5.5 s |
| network | i9-9880H, 16 threads | 159 s, 191 s | 28 | 5.7–6.8 s | 5 s |

The i9-12900K row is the machine the structural variant portal ran on, measured 2026-10-07 with `--local`
(`results/portals-gene.json` holds three of the six runs, the other three ran `make-portal` by hand). The network row
is from 2026-10-05 with `--hub hg38 --reference-track hg38-gencodeComp`. No capture failed in any run, and every run
found the same models, flags and cards. Reading from local disk saves about a fifth on the laptop, so the time per
screenshot is the capture: `gene-review-portal` starts one `@jbrowse/capture` process per card, one at a time, at 40–58%
of one core.

The local run reads GENCODE v49 cut to chr22 (`scripts/portals/fetch-tiberius.sh`). `gene-review-portal` reads a local
GFF into one string, and the whole-genome file fails with `ERR_STRING_TOO_LONG`. Write the output to disk: the portal
copies the 1 GB FASTA into its output directory, and a tmpfs `/tmp` ran out of quota on the second run.

The published `jbrowse` CLI's `--with-app` bundles v4.3.0, which lacks the readiness marker, so every capture timed
out against it.

## Rerunning

```bash
make portals-fetch PORTAL_DATA=~/data/colo829-portal    # 242 GiB, resumable
make portals-variant PORTAL_DATA=~/data/colo829-portal  # → results/portals-variant.json
make portals-gene-fetch                                 # inputs into ~/data/tiberius-portal
make portals-gene APP_DIR=<jbrowse-web build>           # → results/portals-gene.json
```

The JSON files record the host, CPU, tool versions and every run.
