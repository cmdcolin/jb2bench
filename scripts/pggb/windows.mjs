// node windows.mjs [N] [WINDOW_BP] [SPAN]: the seeded random windows of
// gfa-to-tabix scripts/anchored-windows.mjs, one "start end" per line
const [n = 50, windowBp = 10000, span = 57227415] = process.argv.slice(2).map(Number)
let seed = 7
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed / 2 ** 31
}
for (let i = 0; i < n; i++) {
  const start = Math.floor(random() * (span - windowBp))
  console.log(start, start + windowBp)
}
