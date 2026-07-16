// Debounced, cancellable parse scheduling (PRD §8, "Worker").
//
// The store hands text here; we run the parse off the main thread and call back
// with only the freshest result. Two backends:
//   • browser — a module Worker, debounced 200ms, ignoring any response whose id
//     is not the latest request (stale parses are simply dropped).
//   • no Worker (unit tests / SSR) — a synchronous inline parse, applied
//     immediately, so behaviour stays deterministic and easy to assert.
import type { Diagnostic, Schema } from '../model/types.ts';
import { parse } from './parser.ts';

export interface ParseResult {
  schema: Schema;
  diagnostics: Diagnostic[];
}

const DEBOUNCE_MS = 200;

export interface ParseScheduler {
  /** Queue `text` for parsing; supersedes any in-flight request. */
  request(text: string, now: string): void;
  dispose(): void;
}

export function createParseScheduler(onResult: (r: ParseResult) => void): ParseScheduler {
  let worker: Worker | null = null;
  if (typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
  }

  let reqId = 0; // id of the most recent request
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { text: string; now: string } | null = null;

  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number } & ParseResult>) => {
      if (e.data.id !== reqId) return; // a newer request is already in flight
      onResult({ schema: e.data.schema, diagnostics: e.data.diagnostics });
    };
  }

  const fire = () => {
    timer = null;
    if (!pending || !worker) return;
    const { text, now } = pending;
    pending = null;
    worker.postMessage({ id: reqId, text, now });
  };

  return {
    request(text, now) {
      reqId++;
      if (!worker) {
        // synchronous fallback — no debounce, apply right away
        onResult(parse(text, now));
        return;
      }
      pending = { text, now };
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, DEBOUNCE_MS);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      worker?.terminate();
      worker = null;
    },
  };
}
