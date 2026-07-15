// Bridges parser diagnostics into CodeMirror's lint gutter. See PRD §5.4.
import { type Diagnostic as CmDiagnostic, linter } from '@codemirror/lint';
import { parse } from './parser.ts';

export function pglLinter() {
  return linter((view) => {
    const text = view.state.doc.toString();
    const { diagnostics } = parse(text);
    const out: CmDiagnostic[] = [];
    for (const d of diagnostics) {
      if (!d.range) continue;
      out.push({
        from: Math.min(d.range.from, text.length),
        to: Math.min(Math.max(d.range.to, d.range.from + 1), text.length),
        severity: d.severity === 'info' ? 'info' : d.severity,
        message: `${d.code}: ${d.message}`,
      });
    }
    return out;
  });
}
