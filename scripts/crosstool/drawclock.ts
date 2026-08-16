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
