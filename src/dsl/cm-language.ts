// CodeMirror 6 language support for the .pgl DSL: a StreamLanguage tokenizer
// plus a highlight style that maps tokens to CSS variables (theme-aware).
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import { TYPE_CATALOG } from '../sql/types.ts';

const KEYWORDS = new Set([
  'project',
  'namespace',
  'enum',
  'table',
  'as',
  'ref',
  'indexes',
  'checks',
  'note',
  'group',
  'description',
]);

const SETTINGS = new Set([
  'pk',
  'primary',
  'key',
  'increment',
  'not',
  'null',
  'unique',
  'default',
  'identity',
  'generated',
  'check',
  'collate',
  'color',
  'delete',
  'update',
  'name',
  'type',
  'where',
  'include',
  'asc',
  'desc',
  'nulls',
  'first',
  'last',
  'always',
  'by',
  'cascade',
  'restrict',
  'action',
  'set',
]);

const TYPES = new Set<string>();
for (const spec of TYPE_CATALOG) {
  TYPES.add(spec.name);
  for (const a of spec.aliases) TYPES.add(a);
}

interface State {
  inString: false | "'" | '"' | 'triple' | 'raw';
}

export const pglLanguage = StreamLanguage.define<State>({
  name: 'pgl',
  startState: () => ({ inString: false }),
  token(stream, state) {
    // continue an open string across lines (triple-quoted / backtick)
    if (state.inString === 'triple') {
      if (stream.match("'''")) {
        state.inString = false;
        return 'string';
      }
      stream.next();
      return 'string';
    }
    if (state.inString === 'raw') {
      if (stream.match('`')) {
        state.inString = false;
        return 'string';
      }
      stream.next();
      return 'string';
    }

    if (stream.eatSpace()) return null;

    // comments
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      while (!stream.eol()) {
        if (stream.match('*/')) break;
        stream.next();
      }
      return 'comment';
    }

    // strings
    if (stream.match("'''")) {
      state.inString = 'triple';
      return 'string';
    }
    if (stream.peek() === '`') {
      stream.next();
      while (!stream.eol()) {
        if (stream.peek() === '`') {
          stream.next();
          return 'string';
        }
        stream.next();
      }
      state.inString = 'raw';
      return 'string';
    }
    if (stream.peek() === "'" || stream.peek() === '"') {
      const q = stream.next();
      while (!stream.eol()) {
        const c = stream.next();
        if (c === q) {
          if (stream.peek() === q) {
            stream.next(); // doubled-quote escape
            continue;
          }
          return 'string';
        }
      }
      return 'string';
    }

    // hex color
    if (stream.match(/^#[0-9a-fA-F]{3,8}/)) return 'atom';

    // number
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';

    // ref operators
    if (stream.match(/^[<>-]/)) return 'operator';

    // punctuation
    if (stream.match(/^[{}[\]().,:]/)) return 'punctuation';

    // identifiers / keywords
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (word) {
      const w = word[0].toLowerCase();
      if (KEYWORDS.has(w)) return 'keyword';
      if (TYPES.has(w)) return 'typeName';
      if (SETTINGS.has(w)) return 'propertyName';
      return 'variableName';
    }

    stream.next();
    return null;
  },
  tokenTable: {},
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--cm-keyword)', fontWeight: '600' },
  { tag: t.typeName, color: 'var(--cm-type)' },
  { tag: t.propertyName, color: 'var(--cm-setting)' },
  { tag: t.variableName, color: 'var(--cm-ident)' },
  { tag: t.string, color: 'var(--cm-string)' },
  { tag: t.number, color: 'var(--cm-number)' },
  { tag: t.atom, color: 'var(--cm-number)' },
  { tag: t.operator, color: 'var(--cm-operator)' },
  { tag: t.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: t.punctuation, color: 'var(--cm-punct)' },
]);

export function pgl(): Extension {
  return [pglLanguage, syntaxHighlighting(highlight)];
}
