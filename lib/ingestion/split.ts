// Recursive window splitting for saturated discovery calls.
//
// When x_search saturates a window (returns the max results and the caller
// suspects more predictions exist), we split the window in half and re-query
// each half. This keeps discovery bounded — never widening — while still
// giving up cleanly when a window becomes trivially small.

export type Window = { fromDate: string; toDate: string };

const MIN_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day

export function splitWindow(window: Window): [Window, Window] | null {
  const from = new Date(window.fromDate).getTime();
  const to = new Date(window.toDate).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const span = to - from;
  if (span < MIN_WINDOW_MS * 2) return null;
  const mid = new Date(from + Math.floor(span / 2)).toISOString();
  return [
    { fromDate: window.fromDate, toDate: mid },
    { fromDate: mid, toDate: window.toDate },
  ];
}

// Walk a top-level window, yielding sub-windows to query. A caller invokes
// `next()` after each discovery, passing back whether the just-queried window
// saturated. If it did, the next two children replace it in the queue; if not,
// we advance. Cap prevents runaway on pathological saturation.
export function createSaturationQueue(root: Window, options: { maxWindows?: number } = {}) {
  const cap = options.maxWindows ?? 12;
  const queue: Window[] = [root];
  let visited = 0;

  return {
    next(): Window | null {
      const window = queue.shift();
      if (!window || visited >= cap) return null;
      visited += 1;
      return window;
    },
    reportSaturated(window: Window): boolean {
      const parts = splitWindow(window);
      if (!parts) return false;
      queue.unshift(parts[1]);
      queue.unshift(parts[0]);
      return true;
    },
    get remaining() {
      return queue.length;
    },
    get visitedCount() {
      return visited;
    },
  };
}
