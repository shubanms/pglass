// The DSL parser, run off the main thread (PRD §8, "Worker").
//
// On a 300-table document a synchronous parse on every keystroke would jank the
// UI. The store debounces and posts `{ id, text, now }` here; we parse and post
// back `{ id, schema, diagnostics }`. The `id` lets the store ignore results for
// text it has already superseded. The parser never throws, so no error channel
// is needed — a broken document comes back with diagnostics and a partial schema.
import { parse } from './parser.ts';

interface ParseRequest {
  id: number;
  text: string;
  now: string;
}

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  const { id, text, now } = e.data;
  const { schema, diagnostics } = parse(text, now);
  (self as unknown as Worker).postMessage({ id, schema, diagnostics });
};
