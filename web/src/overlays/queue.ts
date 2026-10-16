export function createVisualQueue<T>(options: {
  duration: (item: T) => number;
  start: (item: T) => void;
  finish: () => void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
  maxPending?: number;
}) {
  const pending: T[] = [];
  let active = false;
  let disposed = false;
  let timer: unknown;
  const schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms));
  const cancel =
    options.cancel ||
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  function next() {
    if (disposed || active || !pending.length) return;
    active = true;
    const item = pending.shift()!;
    options.start(item);
    timer = schedule(() => {
      options.finish();
      active = false;
      next();
    }, options.duration(item));
  }
  return {
    push(item: T) {
      if (disposed) return;
      if (pending.length >= (options.maxPending ?? 100)) pending.shift();
      pending.push(item);
      next();
    },
    dispose() {
      disposed = true;
      pending.length = 0;
      cancel(timer);
      options.finish();
    },
    get pending() {
      return pending.length;
    },
  };
}
