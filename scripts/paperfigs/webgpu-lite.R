#!/usr/bin/env Rscript
# results/figures/paper/tex/{webgpu-lite-table,webgpu-lite-macros}.tex from
# results/paper/webgpu-lite.csv: the second panel of Supplementary Table S12,
# WebGPU, WebGL 2 and Canvas 2D in Firefox on three laptops, and the numbers the
# Results and the response letter quote from it. The claims are printed at the
# end, to be checked after any rerun.
#
#   Rscript scripts/paperfigs/webgpu-lite.R

d <- read.csv("results/paper/webgpu-lite.csv", stringsAsFactors = FALSE)

LAPTOPS <- c("cdiesh-Precision-7540" = "Dell Precision 7540",
             "colin-940Z5L" = "Samsung 940Z5L",
             "colins-MacBook-Pro" = "MacBook Pro (2019)")
MAC <- "colins-MacBook-Pro"
BACKENDS <- c(WebGPU = "WebGPU", WebGL2 = "WebGL 2", Canvas2D = "Canvas 2D")
CASES <- c("20x-shortread", "100x-shortread", "20x-longread", "100x-longread")
stopifnot(setequal(unique(d$host), names(LAPTOPS)), setequal(unique(d$case), CASES))

ms <- function(host, backend, case = CASES)
  vapply(case, function(k) d$median_ms[d$host == host & d$backend == backend & d$case == k],
         numeric(1))
cpu_label <- function(host) gsub("\\(R\\)|\\(TM\\)", "", sub(" CPU @.*", "", d$cpu[d$host == host][1]))

table_rows <- unlist(lapply(seq_along(LAPTOPS), function(i) {
  host <- names(LAPTOPS)[i]
  first <- c(LAPTOPS[[host]], paste0("(", cpu_label(host), ")"), "")
  rows <- vapply(seq_along(BACKENDS), function(j) {
    sprintf("%s & %s & %s \\\\", first[j], BACKENDS[[j]],
            paste(sprintf("%.2f", ms(host, names(BACKENDS)[j]) / 1000), collapse = " & "))
  }, character(1))
  if (i < length(LAPTOPS)) c(rows, "\\midrule") else rows
}))
tex <- c("\\begin{tabular}{@{}llrrrr@{}}", "\\toprule",
         "& & \\multicolumn{2}{c}{Short reads} & \\multicolumn{2}{c}{Long reads} \\\\",
         "\\cmidrule(lr){3-4}\\cmidrule(lr){5-6}",
         "Laptop & Backend & 20$\\times$ & 100$\\times$ & 20$\\times$ & 100$\\times$ \\\\",
         "\\midrule", table_rows, "\\bottomrule", "\\end{tabular}")

pct <- function(x) sprintf("%.0f", 100 * (x - 1))
gpu_over_gl <- unlist(lapply(names(LAPTOPS), function(h) ms(h, "WebGPU") / ms(h, "WebGL2")))
mac_gl_over_gpu <- ms(MAC, "WebGL2") / ms(MAC, "WebGPU")
canvas_over_gpu <- unlist(lapply(names(LAPTOPS), function(h) ms(h, "Canvas2D") / ms(h, "WebGPU")))
macros <- c(
  sprintf("\\newcommand{\\LaptopBuild}{%s}", sub("^release-", "", unique(d$build))),
  sprintf("\\newcommand{\\LaptopCount}{%s}", c("one", "two", "three", "four")[length(LAPTOPS)]),
  sprintf("\\newcommand{\\LaptopWebgpuSlowerMaxPct}{%s}", pct(max(gpu_over_gl))),
  sprintf("\\newcommand{\\LaptopMacWebglSlowerMinPct}{%s}", pct(min(mac_gl_over_gpu))),
  sprintf("\\newcommand{\\LaptopMacWebglSlowerMaxPct}{%s}", pct(max(mac_gl_over_gpu))),
  sprintf("\\newcommand{\\LaptopCanvasSlowerMaxPct}{%s}", pct(max(canvas_over_gpu))))

dir.create("results/figures/paper/tex", recursive = TRUE, showWarnings = FALSE)
writeLines(tex, "results/figures/paper/tex/webgpu-lite-table.tex")
writeLines(macros, "results/figures/paper/tex/webgpu-lite-macros.tex")
cat("wrote results/figures/paper/tex/{webgpu-lite-table,webgpu-lite-macros}.tex\n")

for (h in names(LAPTOPS)) {
  cat(sprintf("%s: WebGPU / WebGL 2 %s; Canvas 2D / WebGPU %s; highest load %.1f\n", LAPTOPS[[h]],
              paste(sprintf("%.2f", ms(h, "WebGPU") / ms(h, "WebGL2")), collapse = " "),
              paste(sprintf("%.2f", ms(h, "Canvas2D") / ms(h, "WebGPU")), collapse = " "),
              max(d$load_max[d$host == h])))
}
cat(sprintf("WebGPU at most %s%% slower than WebGL 2 in any cell\n", pct(max(gpu_over_gl))))
cat(sprintf("MacBook: WebGL 2 %s-%s%% slower than WebGPU\n",
            pct(min(mac_gl_over_gpu)), pct(max(mac_gl_over_gpu))))
cat(sprintf("Canvas 2D at most %s%% slower than WebGPU; faster in %d of %d cells\n",
            pct(max(canvas_over_gpu)), sum(canvas_over_gpu < 1), length(canvas_over_gpu)))
