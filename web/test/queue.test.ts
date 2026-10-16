import { expect, test } from "bun:test";
import { createVisualQueue } from "../src/overlays/queue";

test("visual queue serializes bursts using each alert duration, not dispatch cadence", () => {
  const scheduled: { fn: () => void; ms: number }[] = [];
  const started: string[] = [];
  let finishes = 0;
  const queue = createVisualQueue<{ name: string; duration: number }>({
    duration: (item) => item.duration,
    start: (item) => started.push(item.name),
    finish: () => finishes++,
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    cancel: () => {},
  });
  queue.push({ name: "first", duration: 6000 });
  queue.push({ name: "second", duration: 3000 });
  queue.push({ name: "third", duration: 8000 });
  expect(started).toEqual(["first"]);
  expect(scheduled[0].ms).toBe(6000);
  expect(queue.pending).toBe(2);
  scheduled[0].fn();
  expect(started).toEqual(["first", "second"]);
  expect(scheduled[1].ms).toBe(3000);
  scheduled[1].fn();
  expect(started).toEqual(["first", "second", "third"]);
  expect(scheduled[2].ms).toBe(8000);
  scheduled[2].fn();
  expect(finishes).toBe(3);
  expect(queue.pending).toBe(0);
});

test("disposing an overlay cancels its timer and discards pending items", () => {
  let cancelled: unknown;
  let starts = 0;
  const queue = createVisualQueue<number>({
    duration: () => 2000,
    start: () => starts++,
    finish: () => {},
    schedule: () => 123,
    cancel: (timer) => {
      cancelled = timer;
    },
  });
  queue.push(1);
  queue.push(2);
  queue.dispose();
  queue.push(3);
  expect(cancelled).toBe(123);
  expect(starts).toBe(1);
  expect(queue.pending).toBe(0);
});

test("a burst has bounded memory and retains the most recent pending alerts", () => {
  const tasks: (() => void)[] = [];
  const starts: number[] = [];
  const queue = createVisualQueue<number>({
    maxPending: 2,
    duration: () => 1000,
    start: (item) => starts.push(item),
    finish: () => {},
    schedule: (fn) => {
      tasks.push(fn);
    },
    cancel: () => {},
  });
  [1, 2, 3, 4].forEach((item) => queue.push(item));
  tasks[0]();
  tasks[1]();
  expect(starts).toEqual([1, 3, 4]);
});
