// A draw clock: when did this page last put pixels on a canvas?
//
// Written because paint quiescence — poll a screenshot, wait for the hash to
// repeat — cannot resolve a pan. The detector needs STABLE_POLLS+1 samples at
// best, and one `page.screenshot()` on this box has measured between 43 and
// 161 ms, which puts its floor between roughly 450 and 1100 ms against pans of
// about that length. Steps duly came back resolved in exactly the minimum six
// polls, reporting numbers made almost entirely of instrument.
//
// A first version of this comment attributed the screenshot cost to the page —
// 43 ms for JBrowse against 161 ms for igv, and therefore a bias between the two
// columns. `quiescheck.ts` then measured the opposite assignment on a busier
// box (157 ms JBrowse, 49 ms igv), so what varies is the machine and not the
// page. The floor is disqualifying either way; the asymmetry was not
// established and is not claimed.
//
// So stop photographing. Both tools ultimately put pixels on a canvas through
// the same browser APIs, so patch those and record a timestamp per call. That
// is tool-agnostic in the way screenshots were supposed to be but are not: it
// asks the platform, not the application, and it costs a push to an array
// instead of a composite and a PNG encode.
//
// What it deliberately does not do: patch anything JBrowse- or igv-specific,
// read either tool's loading state, or distinguish a "real" draw from a small
// one. Time-to-content is the last draw before the page goes quiet.
//
// Caveats worth carrying:
//
//   - A canvas draw is not a screen paint. The compositor still has to put it
//     up, so this reads slightly EARLIER than the eye. Paint quiescence reads
//     later. They bracket the truth, and `INSTRUMENT=paint` keeps the other one
//     available for comparison.
//   - Work in a worker is invisible here unless it lands on a main-thread
//     canvas. Both tools composite to the visible canvas on the main thread, so
//     the final draw is caught either way — but a tool that finished decoding
//     and never drew would look instant, which is why callers must also require
//     that at least one draw happened.
//   - A page that animates forever (a spinner drawn to canvas) never goes
//     quiet. That is a true statement about the page and shows up as a timeout
//     rather than a fast result.

/**
 * Source for `page.evaluateOnNewDocument`. Must run before the tool's own
 * scripts, so it wraps the prototypes before any context is created.
 */
export const DRAW_CLOCK_INIT = `(() => {
  const w = window;
  w.__drawClock = { count: 0, last: 0, started: performance.now() };
  const mark = () => {
    w.__drawClock.count++;
    w.__drawClock.last = performance.now();
  };
  // 2D and both WebGL levels. Only the calls that can change pixels — state
  // setters are not draws, and counting them would make "quiet" unreachable on
  // a page that merely rebinds buffers.
  const targets = [
    [globalThis.CanvasRenderingContext2D, ['drawImage', 'putImageData', 'fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'clearRect']],
    [globalThis.WebGLRenderingContext, ['drawArrays', 'drawElements', 'clear']],
    [globalThis.WebGL2RenderingContext, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'clear']],
    [globalThis.OffscreenCanvasRenderingContext2D, ['drawImage', 'putImageData', 'fillRect', 'fill', 'stroke', 'clearRect']],
  ];
  for (const [ctor, methods] of targets) {
    if (!ctor || !ctor.prototype) continue;
    for (const name of methods) {
      const orig = ctor.prototype[name];
      if (typeof orig !== 'function') continue;
      ctor.prototype[name] = function (...args) {
        mark();
        return orig.apply(this, args);
      };
    }
  }
})()`

/** Reset the counter and stamp a start time, in page time. */
export const DRAW_CLOCK_RESET = `(() => {
  const c = window.__drawClock;
  c.count = 0;
  c.last = 0;
  c.started = performance.now();
  return c.started;
})()`

/**
 * The completion rule, in one place because two callers had it and a fix would
 * otherwise land in only one.
 *
 * **The rule is positive: a canvas was drawn after the region's bytes arrived.**
 * That is a statement about something happening, and it is what "the track is
 * showing the new data" actually means. Waiting for the page to go quiet is the
 * opposite kind of statement — it cannot distinguish "finished" from "pausing",
 * and every wrong number this instrument has produced came from that confusion.
 *
 * The trace that settles it, a 1000x-shortread pan in JBrowse:
 *
 *     t=6ms      10 draws     re-projection of reads already held
 *     t=6-507    nothing at all — the 500ms LGVCoarseDynamicBlocks debounce
 *     t=507      20 draws
 *     t=507-1251 draws stop; in-flight touches 0 in a ~300ms lull
 *     t=1251-2069  the actual fetch
 *     t=2345     48 draws     THE ANSWER
 *
 * A quiet-based rule fires twice before 1251 and reports 42 ms for 2.3 s of
 * work. The positive rule cannot: at both false points, no draw had happened
 * *after* the last byte landed.
 *
 * `quietMs` remains, demoted to what it should always have been — a settling
 * margin on the final draw burst, not the criterion. Raising it costs wall clock
 * and never inflates the answer, because what is reported is the timestamp of
 * the last draw rather than the moment the detector became sure.
 *
 * A step that fetched nothing (JBrowse serves some pans from a 256 KiB block it
 * already holds) has no "bytes arrived" to be after, so it falls back to draw
 * plus settle. Those steps are counted separately by the caller and excluded
 * from the headline for exactly that reason.
 */
export function isContentDrawn(s: {
  drawCount: number
  /** wall-clock ms of the last draw */
  lastDrawAt: number
  /** wall-clock ms of the last network event (start or finish) */
  lastNetworkAt: number
  inFlight: number
  now: number
  quietMs: number
}) {
  return (
    s.drawCount > 0 &&
    s.inFlight <= 0 &&
    s.now - s.lastDrawAt > s.quietMs &&
    s.now - s.lastNetworkAt > s.quietMs
  )
}

/**
 * How long both channels must be still before the last draw is believed.
 *
 * Two measured constants it has to clear, and it is set from them rather than
 * picked:
 *
 *   ~501 ms  JBrowse's LGVCoarseDynamicBlocks debounce. After a pan it
 *            re-projects held reads immediately and then does nothing at all
 *            for half a second. A 400 ms window fires inside that gap and
 *            reports 42 ms for 2.3 s of work.
 *   ~700 ms  how long after the pan its worker's first request appears. Until
 *            then there is no network activity either, so the network channel
 *            cannot rescue a too-short window.
 *
 * 1500 ms clears both with margin. It costs wall clock per step and **never
 * inflates a result**, because what is reported is the timestamp of the last
 * canvas draw, not the moment the detector became sure.
 *
 * An earlier version tried a stricter, more appealing rule — require a draw
 * *after* the last data response, so completion is a positive fact rather than
 * an absence. It works on JBrowse, whose worker fetches and whose main thread
 * then draws, and it is unusable on igv.js, which parses and draws interleaved
 * on one thread: traced at 20x, igv's last draw lands 1 ms after its last
 * response, so the ordering test is a coin toss and the run hangs about half
 * the time. The rule has to hold for both tools or it is not an instrument.
 */
export const DEFAULT_QUIET_MS = 1500

/**
 * Read the result: time from reset to the last draw, how many there were, and
 * how long ago the last one was. `sinceLast` is computed in page time so the
 * caller never has to reconcile two clocks.
 */
export const DRAW_CLOCK_READ = `(() => {
  const c = window.__drawClock;
  return {
    count: c.count,
    ms: c.last - c.started,
    sinceLast: c.count === 0 ? 0 : performance.now() - c.last,
  };
})()`
