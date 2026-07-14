// Hand-rolled lexer for the .pgl DSL. See PRD §5.1.
// Emits a flat token stream with source offsets. Never throws — an
// unterminated string becomes a token flagged `unterminated` for the parser.

export type TokKind =
  | 'ident' // bare identifier
  | 'string' // '...'  (single-quoted)
  | 'dstring' // "..."  (double-quoted: ident OR string, parser decides)
  | 'tstring' // '''...''' (triple-quoted multiline)
  | 'raw' // `...` backtick raw SQL
  | 'number'
  | 'hexcolor' // #RRGGBB
  | 'lbrace'
  | 'rbrace'
  | 'lbrack'
  | 'rbrack'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'dot'
  | 'gt'
  | 'lt'
  | 'dash'
  | 'eof';

export interface Token {
  kind: TokKind;
  /** decoded value for string-ish tokens; raw text otherwise */
  value: string;
  from: number;
  to: number;
  /** set on string tokens that never saw their closing quote */
  unterminated?: boolean;
}

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';
const isHex = (c: string) => /[0-9a-fA-F]/.test(c);

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const push = (kind: TokKind, value: string, from: number, to: number, unterminated?: boolean) =>
    tokens.push(unterminated ? { kind, value, from, to, unterminated } : { kind, value, from, to });

  while (i < n) {
    const c = src[i]!;

    // whitespace
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
      continue;
    }

    // comments
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; // consume */  (tolerant if EOF)
      continue;
    }

    const start = i;

    // punctuation & operators
    const single: Record<string, TokKind> = {
      '{': 'lbrace',
      '}': 'rbrace',
      '[': 'lbrack',
      ']': 'rbrack',
      '(': 'lparen',
      ')': 'rparen',
      ',': 'comma',
      ':': 'colon',
      '.': 'dot',
      '>': 'gt',
      '<': 'lt',
      '-': 'dash',
    };
    if (single[c]) {
      i++;
      push(single[c]!, c, start, i);
      continue;
    }

    // hex color
    if (c === '#') {
      i++;
      let hex = '';
      while (i < n && isHex(src[i]!)) {
        hex += src[i];
        i++;
      }
      push('hexcolor', `#${hex}`, start, i);
      continue;
    }

    // backtick raw SQL
    if (c === '`') {
      i++;
      let val = '';
      while (i < n && src[i] !== '`') {
        val += src[i];
        i++;
      }
      const unterminated = i >= n;
      if (!unterminated) i++; // closing backtick
      push('raw', val, start, i, unterminated);
      continue;
    }

    // triple-quoted string
    if (c === "'" && src[i + 1] === "'" && src[i + 2] === "'") {
      i += 3;
      let val = '';
      while (i < n && !(src[i] === "'" && src[i + 1] === "'" && src[i + 2] === "'")) {
        val += src[i];
        i++;
      }
      const unterminated = i >= n;
      if (!unterminated) i += 3;
      push('tstring', val, start, i, unterminated);
      continue;
    }

    // single-quoted string (with '' → ' escape)
    if (c === "'") {
      i++;
      let val = '';
      let unterminated = false;
      for (;;) {
        if (i >= n) {
          unterminated = true;
          break;
        }
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            val += "'";
            i += 2;
            continue;
          }
          i++; // closing quote
          break;
        }
        val += src[i];
        i++;
      }
      push('string', val, start, i, unterminated);
      continue;
    }

    // double-quoted string / identifier (with "" → " escape)
    if (c === '"') {
      i++;
      let val = '';
      let unterminated = false;
      for (;;) {
        if (i >= n) {
          unterminated = true;
          break;
        }
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            val += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        val += src[i];
        i++;
      }
      push('dstring', val, start, i, unterminated);
      continue;
    }

    // number (integer or decimal, optional leading dash handled by parser)
    if (isDigit(c)) {
      let val = '';
      while (i < n && (isDigit(src[i]!) || src[i] === '.')) {
        val += src[i];
        i++;
      }
      push('number', val, start, i);
      continue;
    }

    // bare identifier / keyword
    if (isIdentStart(c)) {
      let val = '';
      while (i < n && isIdentPart(src[i]!)) {
        val += src[i];
        i++;
      }
      push('ident', val, start, i);
      continue;
    }

    // unknown char — emit as a 1-char ident so the parser can flag PGL001
    i++;
    push('ident', c, start, i);
  }

  tokens.push({ kind: 'eof', value: '', from: n, to: n });
  return tokens;
}
