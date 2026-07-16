// Context-aware autocompletion for the .pgl editor: types, setting keys, and
// live table/column names pulled from the current schema.
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Schema } from '../model/types.ts';
import { TYPE_CATALOG } from '../sql/types.ts';

const SETTING_KEYS = [
  'pk',
  'increment',
  'not null',
  'null',
  'unique',
  'default',
  'identity',
  'generated',
  'check',
  'collate',
  'color',
  'ref',
  'note',
  'unique',
  'type',
  'name',
  'where',
  'include',
];

const TOP_KEYWORDS = [
  'project',
  'namespace',
  'enum',
  'view',
  'table',
  'ref',
  'group',
  'note',
  'indexes',
];

export function pglAutocomplete(getSchema: () => Schema) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w.]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const line = context.state.doc.lineAt(context.pos).text.slice(0, context.pos);
    const inBrackets = line.lastIndexOf('[') > line.lastIndexOf(']');
    const afterRef = /\b(ref\s*:\s*[<>-]?|[<>-])\s*[\w.]*$/.test(line);

    const schema = getSchema();
    const options: { label: string; type: string; detail?: string }[] = [];

    if (afterRef) {
      // complete table names (and table.column once a dot is typed)
      for (const tbl of schema.tables) {
        options.push({ label: tbl.name, type: 'class', detail: 'table' });
      }
      const dot = word.text.lastIndexOf('.');
      if (dot >= 0) {
        const tblName = word.text.slice(0, dot).toLowerCase();
        const tbl = schema.tables.find((tt) => tt.name.toLowerCase() === tblName);
        for (const c of tbl?.columns ?? []) {
          options.push({ label: `${tbl!.name}.${c.name}`, type: 'property', detail: 'column' });
        }
      }
    } else if (inBrackets) {
      for (const k of SETTING_KEYS) options.push({ label: k, type: 'keyword' });
    } else {
      // column-type position or statement start
      for (const spec of TYPE_CATALOG) {
        options.push({ label: spec.name, type: 'type', detail: spec.category });
      }
      for (const en of schema.enums) options.push({ label: en.name, type: 'enum', detail: 'enum' });
      for (const kw of TOP_KEYWORDS) options.push({ label: kw, type: 'keyword' });
    }

    // de-dupe by label
    const seen = new Set<string>();
    const deduped = options.filter((o) => (seen.has(o.label) ? false : seen.add(o.label)));

    return {
      from: word.from + Math.max(0, word.text.lastIndexOf('.') + 1),
      options: deduped,
      validFor: /^[\w.]*$/,
    };
  };
}
