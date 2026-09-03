// An optimized pure-JavaScript UPGMA, for the middle column of the clustering
// comparison.
//
// greenelab/hclust (vendor/) is the naive "before" and @gmod/hclust's wasm is
// the "after", but they differ in two ways at once: language AND algorithm.
// greenelab rescans every cluster pair each iteration and recomputes
// averageDistance over the index sets, so its merge phase is O(N^4); the wasm
// uses Lance-Williams with cached nearest neighbours, ~O(N^2). Comparing them
// says nothing about what wasm bought.
//
// This is a line-for-line port of src/wasm/distance.c to JavaScript: same
// full N x N float32 matrix, same Lance-Williams UPGMA, same cached-nearest-
// neighbour minimum search, same (distance, size, slot) tie-breaks. Everything
// algorithmic is held fixed, so the gap left over against the wasm is the
// runtime alone -- scalar JS vs SIMD wasm.
//
// What is optimized here is what a competent JS library would do, and no more:
// flat typed arrays instead of arrays-of-arrays, one triangle computed and
// mirrored, offsets hoisted out of the kernel, integer state in Int32Array,
// four independent accumulators so the sum is not one serial chain of FP-add
// latencies, and two i-rows measured against each streamed j-row so that row
// is loaded once and used twice. Those last two are worth 18% and 22% on a
// 2504 x 3105 matrix; a further 4-row block buys 3% for twice the code, so it
// stops here. There is no JS equivalent of the f32x4 kernel, which is the
// point.
import { performance } from 'node:perf_hooks'

const distanceBetween = (data, ia, ib, vectorSize) => {
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let k = 0
  for (; k + 3 < vectorSize; k += 4) {
    const d0 = data[ia + k] - data[ib + k]
    const d1 = data[ia + k + 1] - data[ib + k + 1]
    const d2 = data[ia + k + 2] - data[ib + k + 2]
    const d3 = data[ia + k + 3] - data[ib + k + 3]
    s0 += d0 * d0
    s1 += d1 * d1
    s2 += d2 * d2
    s3 += d3 * d3
  }
  let sum = s0 + s1 + s2 + s3
  for (; k < vectorSize; k++) {
    const d = data[ia + k] - data[ib + k]
    sum += d * d
  }
  return Math.sqrt(sum)
}

// Rows ia and ib against the same row ic, written to out[0] and out[1]. Each
// element of ic is loaded once and spent on two distances, which is where the
// blocking pays: the kernel is memory-bound on the streamed row, not on the
// arithmetic.
const distancePair = (data, ia, ib, ic, vectorSize, out) => {
  let a0 = 0
  let a1 = 0
  let b0 = 0
  let b1 = 0
  let k = 0
  for (; k + 1 < vectorSize; k += 2) {
    const c0 = data[ic + k]
    const c1 = data[ic + k + 1]
    const x0 = data[ia + k] - c0
    const x1 = data[ia + k + 1] - c1
    const y0 = data[ib + k] - c0
    const y1 = data[ib + k + 1] - c1
    a0 += x0 * x0
    a1 += x1 * x1
    b0 += y0 * y0
    b1 += y1 * y1
  }
  let sumA = a0 + a1
  let sumB = b0 + b1
  for (; k < vectorSize; k++) {
    const c = data[ic + k]
    const x = data[ia + k] - c
    const y = data[ib + k] - c
    sumA += x * x
    sumB += y * y
  }
  out[0] = Math.sqrt(sumA)
  out[1] = Math.sqrt(sumB)
}

// Nearest active neighbour of slot i by (distance, cluster size, slot id).
// The slot id makes the choice canonical where distance and size both tie,
// which is the norm on sparse data rather than a corner case.
const findNearest = (i, distances, numSamples, sizes, activeList, numActive, nn, nnDist, nnSize) => {
  const rowOffset = i * numSamples
  let bestDist = Infinity
  let bestJ = -1
  let bestSize = 0x7fffffff
  for (let aj = 0; aj < numActive; aj++) {
    const j = activeList[aj]
    if (j !== i) {
      const d = distances[rowOffset + j]
      const s = sizes[j]
      if (d < bestDist || (d === bestDist && (s < bestSize || (s === bestSize && j < bestJ)))) {
        bestDist = d
        bestJ = j
        bestSize = s
      }
    }
  }
  nn[i] = bestJ
  nnDist[i] = bestDist
  nnSize[i] = bestSize
}

// The flattened matrix the distance build reads, with the wasm wrapper's
// validation. `data` is the row-vector array everything here takes; a caller
// that already holds the flat Float32Array passes it with `vectorSize` and
// skips the copy, which is what the five-window distance sweep does -- an
// array-of-arrays of the 5,008 x 22,383 matrix is 900MB of JS heap to build a
// Float32Array that is 450MB.
export const flatten = (data, vectorSize) => {
  const flat = data instanceof Float32Array
    ? data
    : new Float32Array(data.length * vectorSize)
  if (flat !== data) {
    for (let i = 0; i < data.length; i++) {
      flat.set(data[i], i * vectorSize)
    }
  }
  // A single NaN would poison every distance silently: NaN compares false
  // everywhere, so find-min skips it and the run produces a wrong tree rather
  // than an error.
  for (let i = 0; i < flat.length; i++) {
    if (!Number.isFinite(flat[i])) {
      throw new Error('input contains non-finite values (NaN or Infinity)')
    }
  }
  return flat
}

// Separated from the merge because it is a measurement in its own right: the
// distance build is the phase the wasm SIMD and the compute shader both
// replace, and the figure that sweeps it across window widths cannot call the
// whole clustering to get it -- greenelab's merge at N = 5,008 does not
// finish. hierarchicalCluster calls this, so there is one implementation.
export const buildDistanceMatrix = (flat, numSamples, vectorSize, onProgress) => {
  const distances = new Float32Array(numSamples * numSamples)
  const progressIntervalMs = 100
  let lastProgressTime = performance.now()
  const totalDistCalcs = numSamples * (numSamples - 1)
  let distCalcsDone = 0

  // The last row of an odd-sized matrix has no j > i, so the pair loop covers
  // every entry without a tail case.
  const pairOut = new Float64Array(2)
  for (let i = 0; i + 1 < numSamples; i += 2) {
    const i2 = i + 1
    const rowOffset = i * numSamples
    const row2Offset = i2 * numSamples
    const ia = i * vectorSize
    const ib = i2 * vectorSize
    const d = distanceBetween(flat, ia, ib, vectorSize)
    distances[rowOffset + i2] = d
    distances[row2Offset + i] = d
    for (let j = i2 + 1; j < numSamples; j++) {
      distancePair(flat, ia, ib, j * vectorSize, vectorSize, pairOut)
      const jOffset = j * numSamples
      distances[rowOffset + j] = pairOut[0]
      distances[jOffset + i] = pairOut[0]
      distances[row2Offset + j] = pairOut[1]
      distances[jOffset + i2] = pairOut[1]
    }
    distCalcsDone += 2 * (2 * (numSamples - i2) - 1)
    if (onProgress) {
      const now = performance.now()
      if (now - lastProgressTime >= progressIntervalMs) {
        onProgress({
          phase: 'distance',
          message: 'Computing distance matrix',
          current: distCalcsDone,
          total: totalDistCalcs,
        })
        lastProgressTime = now
      }
    }
  }
  return distances
}

export const hierarchicalCluster = ({ data, onProgress }) => {
  const t0 = performance.now()
  const numSamples = data.length
  if (numSamples < 2) {
    throw new Error('hierarchicalCluster requires at least 2 samples')
  }
  const vectorSize = data[0].length

  // The wasm wrapper flattens into a Float32Array before it can hand the
  // matrix to wasm, and wasmphases.mjs starts its clock before that, so the
  // flatten sits inside the distance phase on both sides.
  const flat = flatten(data, vectorSize)
  const distances = buildDistanceMatrix(flat, numSamples, vectorSize, onProgress)

  const t1 = performance.now()

  const sizes = new Int32Array(numSamples).fill(1)
  const activeList = new Int32Array(numSamples)
  const activePos = new Int32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    activeList[i] = i
    activePos[i] = i
  }
  let numActive = numSamples

  // UPGMA is reducible, so heights are non-decreasing root-ward in exact
  // arithmetic; float rounding across N-1 chained updates can invert that by
  // an ulp, which shows up as a negative branch length. Clamp each merge up to
  // its children's heights.
  const lastHeight = new Float32Array(numSamples)

  const nn = new Int32Array(numSamples)
  const nnDist = new Float32Array(numSamples)
  const nnSize = new Int32Array(numSamples)
  for (let ai = 0; ai < numActive; ai++) {
    findNearest(activeList[ai], distances, numSamples, sizes, activeList, numActive, nn, nnDist, nnSize)
  }

  const heights = new Float32Array(numSamples - 1)
  const mergeA = new Int32Array(numSamples - 1)
  const mergeB = new Int32Array(numSamples - 1)
  const totalIterations = numSamples - 1
  const progressIntervalMs = 100
  let lastProgressTime = performance.now()

  for (let iteration = 0; iteration < totalIterations; iteration++) {
    if (onProgress) {
      const now = performance.now()
      if (now - lastProgressTime >= progressIntervalMs) {
        onProgress({
          phase: 'clustering',
          message: 'Clustering samples',
          current: iteration,
          total: totalIterations,
        })
        lastProgressTime = now
      }
    }

    let minDist = Infinity
    let minA = -1
    let minB = -1
    let minPairSize = 0x7fffffff
    for (let ai = 0; ai < numActive; ai++) {
      const i = activeList[ai]
      const j = nn[i]
      const d = nnDist[i]
      const pairSize = sizes[i] + nnSize[i]
      const lo = i < j ? i : j
      const hi = i < j ? j : i
      const bestLo = minA < minB ? minA : minB
      const bestHi = minA < minB ? minB : minA
      if (
        d < minDist ||
        (d === minDist &&
          (pairSize < minPairSize ||
            (pairSize === minPairSize && (lo < bestLo || (lo === bestLo && hi < bestHi)))))
      ) {
        minDist = d
        minA = i
        minB = j
        minPairSize = pairSize
      }
    }
    if (minA > minB) {
      const tmp = minA
      minA = minB
      minB = tmp
    }

    const sizeA = sizes[minA]
    const sizeB = sizes[minB]
    const newSize = sizeA + sizeB

    let clampedHeight = minDist
    if (lastHeight[minA] > clampedHeight) {
      clampedHeight = lastHeight[minA]
    }
    if (lastHeight[minB] > clampedHeight) {
      clampedHeight = lastHeight[minB]
    }
    heights[iteration] = clampedHeight
    lastHeight[minA] = clampedHeight
    mergeA[iteration] = minA
    mergeB[iteration] = minB

    const wA = sizeA / newSize
    const wB = sizeB / newSize
    const rowAOffset = minA * numSamples
    const rowBOffset = minB * numSamples
    for (let ai = 0; ai < numActive; ai++) {
      const k = activeList[ai]
      if (k !== minA && k !== minB) {
        const newDist = wA * distances[rowAOffset + k] + wB * distances[rowBOffset + k]
        distances[rowAOffset + k] = newDist
        distances[k * numSamples + minA] = newDist
      }
    }
    sizes[minA] = newSize

    const posB = activePos[minB]
    const lastSlot = activeList[numActive - 1]
    activeList[posB] = lastSlot
    activePos[lastSlot] = posB
    numActive--

    if (numActive >= 2) {
      // minA's whole row moved, so it rescans. For everyone else the only new
      // candidate is minA, an O(1) check -- unless their cached neighbour was
      // minA or minB and is now stale.
      findNearest(minA, distances, numSamples, sizes, activeList, numActive, nn, nnDist, nnSize)
      for (let ai = 0; ai < numActive; ai++) {
        const k = activeList[ai]
        if (k !== minA) {
          if (nn[k] === minA || nn[k] === minB) {
            findNearest(k, distances, numSamples, sizes, activeList, numActive, nn, nnDist, nnSize)
          } else {
            const d = distances[k * numSamples + minA]
            if (
              d < nnDist[k] ||
              (d === nnDist[k] &&
                (newSize < nnSize[k] || (newSize === nnSize[k] && minA < nn[k])))
            ) {
              nn[k] = minA
              nnDist[k] = d
              nnSize[k] = newSize
            }
          }
        }
      }
    }
  }

  const t2 = performance.now()
  return {
    heights,
    merges: { mergeA, mergeB },
    order: leafOrder(numSamples, mergeA, mergeB),
    distanceMs: t1 - t0,
    clusterMs: t2 - t1,
  }
}

// Left-to-right leaf sequence of the rebuilt tree, smaller subtree first, the
// same convention rebuildTree uses on the wasm side so the orders are
// comparable.
const leafOrder = (numSamples, mergeA, mergeB) => {
  const leaves = new Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    leaves[i] = [i]
  }
  for (let i = 0; i < numSamples - 1; i++) {
    const dst = mergeA[i]
    const other = mergeB[i]
    const small = leaves[dst].length > leaves[other].length ? other : dst
    const large = small === dst ? other : dst
    leaves[dst] = leaves[small].concat(leaves[large])
  }
  return leaves[0]
}
