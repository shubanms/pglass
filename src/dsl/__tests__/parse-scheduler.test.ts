import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseResult } from '../parse-scheduler.ts';
import { createParseScheduler } from '../parse-scheduler.ts';

// A controllable stand-in for a Web Worker: it records what was posted and lets
// the test deliver responses back on demand, so we can exercise the debounce
// and stale-id-dropping logic deterministically.
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: Array<{ id: number; text: string; now: string }> = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: { id: number; text: string; now: string }) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  /** Deliver a fake parse result for a given request id. */
  respond(id: number, result: Partial<ParseResult> = {}) {
    this.onmessage?.({
      data: { id, schema: result.schema ?? ({} as never), diagnostics: result.diagnostics ?? [] },
    } as MessageEvent);
  }
}

describe('parse scheduler — worker backend', () => {
  const OriginalWorker = globalThis.Worker;
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('Worker', OriginalWorker);
  });

  it('debounces rapid requests into a single post', () => {
    const sched = createParseScheduler(() => {});
    const w = FakeWorker.instances[0]!;
    sched.request('a', 't1');
    sched.request('ab', 't2');
    sched.request('abc', 't3');
    expect(w.posted).toHaveLength(0); // nothing sent yet — still debouncing
    vi.advanceTimersByTime(200);
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]!.text).toBe('abc'); // only the freshest text is parsed
  });

  it('ignores a stale response and applies only the latest', () => {
    const results: ParseResult[] = [];
    const sched = createParseScheduler((r) => results.push(r));
    const w = FakeWorker.instances[0]!;

    sched.request('one', 't1');
    vi.advanceTimersByTime(200);
    const firstId = w.posted[0]!.id;

    // user types again before the first parse comes back
    sched.request('two', 't2');
    vi.advanceTimersByTime(200);
    const secondId = w.posted[1]!.id;

    // the stale (first) response arrives late and must be dropped
    w.respond(firstId, { diagnostics: [] });
    expect(results).toHaveLength(0);

    // the current response is applied
    w.respond(secondId, { diagnostics: [] });
    expect(results).toHaveLength(1);
  });

  it('terminates the worker on dispose', () => {
    const sched = createParseScheduler(() => {});
    const w = FakeWorker.instances[0]!;
    sched.dispose();
    expect(w.terminated).toBe(true);
  });
});

describe('parse scheduler — synchronous fallback (no Worker)', () => {
  const OriginalWorker = globalThis.Worker;
  beforeEach(() => {
    vi.stubGlobal('Worker', undefined);
  });
  afterEach(() => {
    vi.stubGlobal('Worker', OriginalWorker);
  });

  it('parses inline and applies immediately', () => {
    const results: ParseResult[] = [];
    const sched = createParseScheduler((r) => results.push(r));
    sched.request('table users {\n  id bigint [pk]\n}\n', '2020-01-01T00:00:00.000Z');
    expect(results).toHaveLength(1);
    expect(results[0]!.schema.tables.some((t) => t.name === 'users')).toBe(true);
  });
});
