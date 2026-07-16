// Recursive-descent parser for the .pgl DSL. See PRD §5.
//
// CONTRACT: never throws. On error it records a Diagnostic, recovers to the
// next statement boundary, and keeps going. It always returns a Schema — a
// partial one if needed — so the canvas can keep rendering while the user types.
import {
  newColumnId,
  newEnumId,
  newGroupId,
  newIndexId,
  newNoteId,
  newRelId,
  newTableId,
} from '../model/ids.ts';
import type {
  Column,
  ColumnId,
  Diagnostic,
  EnumType,
  Index,
  IndexKey,
  IndexMethod,
  PgType,
  RefAction,
  Relationship,
  Schema,
  StickyNote,
  Table,
  TableGroup,
} from '../model/types.ts';
import { arityAccepts, canonicalTypeName, isBuiltinType, lookupType } from '../sql/types.ts';
import { type Token, lex } from './lexer.ts';

const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint']);
const REF_ACTIONS: Record<string, RefAction> = {
  cascade: 'cascade',
  restrict: 'restrict',
  'set null': 'set_null',
  'set default': 'set_default',
  'no action': 'no_action',
};

interface PendingRef {
  name?: string;
  sourceTable: string; // qualified name as written
  sourceNamespace: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
  op: '>' | '<' | '-';
  onDelete: RefAction;
  onUpdate: RefAction;
  comment?: string;
  range: { from: number; to: number };
  /** for inline refs: the already-known source column id */
  sourceColumnId?: ColumnId;
}

export interface ParseResult {
  schema: Schema;
  diagnostics: Diagnostic[];
}

export function parse(src: string, now = '1970-01-01T00:00:00.000Z'): ParseResult {
  return new Parser(src, now).parse();
}

class Parser {
  private toks: Token[];
  private pos = 0;
  private diags: Diagnostic[] = [];

  private schema: Schema;
  private currentNamespace = 'public';
  private pendingRefs: PendingRef[] = [];
  private pendingGroups: { name: string; color?: string; tables: string[] }[] = [];
  private aliasToName = new Map<string, string>(); // alias → qualified table name

  constructor(src: string, now: string) {
    this.toks = lex(src);
    this.schema = {
      version: 1,
      name: 'untitled',
      tables: [],
      relationships: [],
      indexes: [],
      enums: [],
      notes: [],
      groups: [],
      namespaces: ['public'],
      meta: { createdAt: now, updatedAt: now },
    };
  }

  // ── token helpers ──
  private peek(k = 0): Token {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)]!;
  }
  private next(): Token {
    const t = this.peek();
    if (this.pos < this.toks.length - 1) this.pos++;
    return t;
  }
  private at(kind: Token['kind']): boolean {
    return this.peek().kind === kind;
  }
  private atKeyword(kw: string): boolean {
    const t = this.peek();
    return t.kind === 'ident' && t.value.toLowerCase() === kw;
  }
  private eat(kind: Token['kind']): Token | null {
    if (this.at(kind)) return this.next();
    return null;
  }

  private diag(
    severity: Diagnostic['severity'],
    code: string,
    message: string,
    from: number,
    to: number,
  ) {
    this.diags.push({ severity, code, message, range: { from, to } });
  }

  /** Skip to the next top-level statement boundary for error recovery. */
  private recover() {
    let depth = 0;
    while (!this.at('eof')) {
      const t = this.peek();
      if (t.kind === 'lbrace') depth++;
      else if (t.kind === 'rbrace') {
        this.next();
        if (depth <= 0) return;
        depth--;
        if (depth === 0) return;
        continue;
      } else if (depth === 0 && t.kind === 'ident' && TOP_KEYWORDS.has(t.value.toLowerCase())) {
        return;
      }
      this.next();
    }
  }

  parse(): ParseResult {
    while (!this.at('eof')) {
      const before = this.pos;
      this.parseStatement();
      if (this.pos === before) this.next(); // guarantee progress
    }
    this.resolveRefs();
    this.resolveGroups();
    // A primary-key column is implicitly NOT NULL in Postgres.
    for (const t of this.schema.tables) {
      for (const cid of t.primaryKey) {
        const c = t.columns.find((x) => x.id === cid);
        if (c) c.notNull = true;
      }
    }
    return { schema: this.schema, diagnostics: this.diags };
  }

  private parseStatement() {
    const t = this.peek();
    if (t.kind !== 'ident') {
      this.diag('error', 'PGL001', `Unexpected token "${t.value}"`, t.from, t.to);
      this.recover();
      return;
    }
    switch (t.value.toLowerCase()) {
      case 'project':
        return this.parseProject();
      case 'namespace':
        return this.parseNamespace();
      case 'enum':
        return this.parseEnum();
      case 'table':
        return this.parseTable();
      case 'ref':
        return this.parseStandaloneRef();
      case 'group':
        return this.parseGroup();
      case 'note':
        return this.parseStandaloneNote();
      default:
        this.diag('error', 'PGL001', `Unexpected token "${t.value}"`, t.from, t.to);
        this.recover();
    }
  }

  // ── project ──
  private parseProject() {
    this.next(); // 'project'
    const nameTok = this.peek();
    let name = 'untitled';
    if (nameTok.kind === 'string' || nameTok.kind === 'dstring') {
      name = nameTok.value;
      this.next();
    }
    this.schema.name = name;
    if (this.eat('lbrace')) {
      while (!this.at('rbrace') && !this.at('eof')) {
        if (this.atKeyword('description')) {
          this.next();
          this.eat('colon');
          const v = this.peek();
          if (v.kind === 'string' || v.kind === 'dstring' || v.kind === 'tstring') {
            this.schema.meta.description = v.value;
            this.next();
          }
        } else {
          this.next();
        }
      }
      this.eat('rbrace');
    }
  }

  // ── namespace ──
  private parseNamespace() {
    this.next();
    const id = this.parseIdent();
    if (id) {
      this.currentNamespace = id;
      if (!this.schema.namespaces.includes(id)) this.schema.namespaces.push(id);
    }
  }

  // ── enum ──
  private parseEnum() {
    this.next(); // 'enum'
    const { namespace, name } = this.parseQualName();
    if (!name) {
      this.recover();
      return;
    }
    const en: EnumType = { id: newEnumId(), namespace, name, values: [] };
    const valueNotes: Record<string, string> = {};
    if (!this.eat('lbrace')) {
      this.recover();
      this.schema.enums.push(en);
      return;
    }
    const seen = new Set<string>();
    while (!this.at('rbrace') && !this.at('eof')) {
      const v = this.peek();
      let value: string | null = null;
      if (v.kind === 'ident' || v.kind === 'string' || v.kind === 'dstring') {
        value = v.value;
        this.next();
      } else {
        this.next();
        continue;
      }
      if (seen.has(value)) {
        this.diag('error', 'PGL012', `Duplicate enum value "${value}"`, v.from, v.to);
      }
      seen.add(value);
      en.values.push(value);
      // optional [note: '...']
      if (this.at('lbrack')) {
        const settings = this.parseSettingsBlock();
        const note = settings.find((s) => s.key === 'note');
        if (note?.value) valueNotes[value] = note.value;
      }
    }
    this.eat('rbrace');
    if (Object.keys(valueNotes).length) en.valueNotes = valueNotes;
    this.schema.enums.push(en);
  }

  // ── table ──
  private parseTable() {
    this.next(); // 'table'
    const startTok = this.peek();
    const { namespace, name } = this.parseQualName();
    if (!name) {
      this.recover();
      return;
    }

    // optional alias
    if (this.atKeyword('as')) {
      this.next();
      const alias = this.parseIdent();
      if (alias) this.aliasToName.set(alias, `${namespace}.${name}`);
    }

    const table: Table = {
      id: newTableId(),
      namespace,
      name,
      columns: [],
      primaryKey: [],
      checks: [],
      pos: { x: 0, y: 0 },
    };

    // duplicate table check
    if (
      this.schema.tables.some(
        (t) =>
          t.namespace.toLowerCase() === namespace.toLowerCase() &&
          t.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      this.diag('error', 'PGL007', `Duplicate table "${name}"`, startTok.from, startTok.to);
    }

    // optional header settings [color: ...]
    if (this.at('lbrack')) {
      const settings = this.parseSettingsBlock();
      for (const s of settings) {
        if (s.key === 'color' && s.value) table.color = s.value;
        else if (s.key === 'note' && s.value) table.comment = s.value;
      }
    }

    if (!this.eat('lbrace')) {
      this.recover();
      this.schema.tables.push(table);
      return;
    }

    const tableIndexes: Index[] = [];
    const seenCols = new Set<string>();

    while (!this.at('rbrace') && !this.at('eof')) {
      if (this.atKeyword('indexes')) {
        this.parseIndexesBlock(table, tableIndexes);
      } else if (this.atKeyword('checks')) {
        this.parseChecksBlock(table);
      } else if (this.atKeyword('note')) {
        this.next();
        this.eat('colon');
        const v = this.peek();
        if (v.kind === 'string' || v.kind === 'dstring' || v.kind === 'tstring') {
          table.comment = v.value;
          this.next();
        } else if (v.kind === 'lbrace') {
          // note { '''...''' }
          this.next();
          const s = this.peek();
          if (s.kind === 'tstring' || s.kind === 'string') {
            table.comment = s.value;
            this.next();
          }
          this.eat('rbrace');
        }
      } else if (this.at('ident')) {
        this.parseColumn(table, seenCols);
      } else {
        this.next();
      }
    }
    this.eat('rbrace');

    this.schema.tables.push(table);
    for (const ix of tableIndexes) this.schema.indexes.push(ix);
  }

  private parseColumn(table: Table, seenCols: Set<string>) {
    const nameTok = this.next();
    const name = nameTok.kind === 'dstring' ? nameTok.value : nameTok.value;
    const type = this.parseType();

    const col: Column = {
      id: newColumnId(),
      name,
      type,
      notNull: false,
      unique: false,
      identity: 'none',
      generated: { kind: 'none' },
    };

    if (seenCols.has(name.toLowerCase())) {
      this.diag('error', 'PGL006', `Duplicate column "${name}"`, nameTok.from, nameTok.to);
    }
    seenCols.add(name.toLowerCase());

    let isPk = false;
    if (this.at('lbrack')) {
      const settings = this.parseSettingsBlock();
      for (const s of settings) {
        this.applyColumnSetting(table, col, s, nameTok.from, nameTok.to, () => {
          isPk = true;
        });
      }
    }

    table.columns.push(col);
    if (isPk) table.primaryKey.push(col.id);
  }

  private applyColumnSetting(
    table: Table,
    col: Column,
    s: Setting,
    from: number,
    to: number,
    markPk: () => void,
  ) {
    switch (s.key) {
      case 'pk':
      case 'primary key':
        markPk();
        break;
      case 'increment': {
        if (!INTEGER_TYPES.has(col.type.name)) {
          this.diag('error', 'PGL015', `"increment" requires an integer type`, from, to);
        }
        col.identity = 'by_default';
        break;
      }
      case 'not null':
        col.notNull = true;
        break;
      case 'null':
        col.notNull = false;
        break;
      case 'unique':
        col.unique = true;
        break;
      case 'default':
        if (s.value !== undefined) col.default = s.value;
        break;
      case 'identity':
        col.identity = s.value === 'always' ? 'always' : 'by_default';
        break;
      case 'generated':
        if (s.value) col.generated = { kind: 'stored', expr: s.value };
        break;
      case 'check':
        if (s.value) col.check = s.value;
        break;
      case 'collate':
        if (s.value) col.collation = s.value;
        break;
      case 'color':
        if (s.value) col.color = s.value;
        break;
      case 'note':
        if (s.value) col.comment = s.value;
        break;
      case 'ref':
        if (s.ref) {
          this.pendingRefs.push({
            ...s.ref,
            sourceTable: `${table.namespace}.${table.name}`,
            sourceNamespace: table.namespace,
            sourceColumns: [col.name],
            sourceColumnId: col.id,
          });
        }
        break;
      default:
        this.diag('error', 'PGL003', `Unknown setting "${s.key}"`, from, to);
    }
  }

  private parseType(): PgType {
    // TypeName ( "(" Int ("," Int)? ")" )? ( "[" "]" )*
    const first = this.peek();
    let baseName = '';
    const nameFrom = first.from;
    let nameTo = first.to;
    if (first.kind === 'ident' || first.kind === 'dstring') {
      baseName = first.value;
      this.next();
      if (this.at('dot')) {
        this.next();
        const second = this.peek();
        if (second.kind === 'ident' || second.kind === 'dstring') {
          baseName = `${baseName}.${second.value}`;
          nameTo = second.to;
          this.next();
        }
      }
    }

    const args: number[] = [];
    if (this.at('lparen')) {
      this.next();
      while (!this.at('rparen') && !this.at('eof')) {
        const numTok = this.peek();
        if (numTok.kind === 'number') {
          args.push(Number.parseInt(numTok.value, 10));
          this.next();
        } else if (numTok.kind === 'comma') {
          this.next();
        } else {
          this.next();
        }
      }
      this.eat('rparen');
    }

    let arrayDims = 0;
    while (this.at('lbrack')) {
      // Only treat "[]" (possibly with a number) as an array suffix; a "[" that
      // begins settings is handled by the caller, so we peek for "]".
      const save = this.pos;
      this.next(); // [
      // allow optional integer size (we ignore the size, keep dims)
      this.eat('number');
      if (this.eat('rbrack')) {
        arrayDims++;
      } else {
        this.pos = save; // not an array suffix — it's a settings block
        break;
      }
    }

    // qualified name → treat the last segment as the type/enum name
    const bare = baseName.includes('.') ? baseName.split('.').pop()! : baseName;
    const spec = lookupType(bare);
    const canonical = spec ? spec.name : baseName;

    if (spec) {
      if (!arityAccepts(spec.arity, args.length)) {
        this.diag(
          'error',
          'PGL005',
          `Type "${spec.name}" does not accept ${args.length} argument(s)`,
          nameFrom,
          nameTo,
        );
      }
    } else if (bare && !this.isDeclaredEnum(bare)) {
      // Might be an enum declared later; we re-check during resolution. For now,
      // only flag clearly-unknown non-enum-looking names if not a builtin.
      // We defer: unknown types are allowed and round-trip (PGL004 emitted at resolve).
      this.pendingUnknownTypes.push({ name: bare, from: nameFrom, to: nameTo });
    }

    return { name: canonicalTypeName(canonical), args, arrayDims };
  }

  private pendingUnknownTypes: { name: string; from: number; to: number }[] = [];

  private isDeclaredEnum(name: string): boolean {
    const nm = name.toLowerCase();
    return this.schema.enums.some((e) => e.name.toLowerCase() === nm);
  }

  private parseIndexesBlock(table: Table, out: Index[]) {
    this.next(); // 'indexes'
    if (!this.eat('lbrace')) return;
    while (!this.at('rbrace') && !this.at('eof')) {
      const keys = this.parseIndexKeys();
      let settings: Setting[] = [];
      if (this.at('lbrack')) settings = this.parseSettingsBlock();

      const isPk = settings.some((s) => s.key === 'pk');
      const isUnique = settings.some((s) => s.key === 'unique');
      const name = settings.find((s) => s.key === 'name')?.value;
      const where = settings.find((s) => s.key === 'where')?.value;
      const note = settings.find((s) => s.key === 'note')?.value;
      const method = (settings.find((s) => s.key === 'type')?.value ?? 'btree') as IndexMethod;

      if (keys.length === 0) continue;

      if (isPk) {
        // Composite/explicit PK declared in indexes block.
        const cols = keys
          .filter((k): k is Extract<IndexKey, { kind: 'column' }> => k.kind === 'column')
          .map((k) => k.column);
        table.primaryKey = cols;
        continue;
      }

      out.push({
        id: newIndexId(),
        table: table.id,
        name,
        unique: isUnique,
        method,
        keys,
        where,
        comment: note,
      });
    }
    this.eat('rbrace');
  }

  private parseIndexKeys(): IndexKey[] {
    const keys: IndexKey[] = [];
    if (this.at('raw')) {
      keys.push({ kind: 'expr', expr: this.next().value });
      return keys;
    }
    if (this.at('lparen')) {
      this.next();
      while (!this.at('rparen') && !this.at('eof')) {
        if (this.at('comma')) {
          this.next();
          continue;
        }
        if (this.at('raw')) {
          keys.push({ kind: 'expr', expr: this.next().value });
          continue;
        }
        const colName = this.parseIdent();
        if (!colName) {
          this.next();
          continue;
        }
        const key: Extract<IndexKey, { kind: 'column' }> = {
          kind: 'column',
          column: colName as unknown as ColumnId, // resolved to id below
        };
        if (this.atKeyword('asc')) {
          this.next();
          key.sort = 'asc';
        } else if (this.atKeyword('desc')) {
          this.next();
          key.sort = 'desc';
        }
        if (this.atKeyword('nulls')) {
          this.next();
          if (this.atKeyword('first')) {
            this.next();
            key.nulls = 'first';
          } else if (this.atKeyword('last')) {
            this.next();
            key.nulls = 'last';
          }
        }
        keys.push(key);
      }
      this.eat('rparen');
    } else {
      const colName = this.parseIdent();
      if (colName) keys.push({ kind: 'column', column: colName as unknown as ColumnId });
    }
    return keys;
  }

  private parseChecksBlock(table: Table) {
    this.next(); // 'checks'
    if (!this.eat('lbrace')) return;
    while (!this.at('rbrace') && !this.at('eof')) {
      const v = this.peek();
      if (v.kind === 'string' || v.kind === 'dstring' || v.kind === 'raw') {
        const expr = v.value;
        this.next();
        let name: string | undefined;
        if (this.at('lbrack')) {
          const settings = this.parseSettingsBlock();
          name = settings.find((s) => s.key === 'name')?.value;
        }
        table.checks.push(name ? { name, expr } : { expr });
      } else {
        this.next();
      }
    }
    this.eat('rbrace');
  }

  // ── standalone ref ──
  private parseStandaloneRef() {
    const startTok = this.next(); // 'ref'
    let name: string | undefined;
    if (this.at('ident') && !this.atKeyword('')) {
      // optional name before ':'
      if (this.peek(1).kind === 'colon') {
        name = this.next().value;
      }
    }
    this.eat('colon');

    const left = this.parseColRefList();
    const op = this.parseRefOp();
    const right = this.parseColRefList();
    if (!left || !right || !op) {
      this.recover();
      return;
    }

    let onDelete: RefAction = 'no_action';
    let onUpdate: RefAction = 'no_action';
    let comment: string | undefined;
    if (this.at('lbrack')) {
      const settings = this.parseSettingsBlock();
      for (const s of settings) {
        if (s.key === 'delete' && s.value) onDelete = REF_ACTIONS[s.value] ?? 'no_action';
        else if (s.key === 'update' && s.value) onUpdate = REF_ACTIONS[s.value] ?? 'no_action';
        else if (s.key === 'name' && s.value) name = s.value;
        else if (s.key === 'note' && s.value) comment = s.value;
      }
    }

    // Normalize direction so source always holds the FK columns.
    // ">" : left → right (left holds FK). "<" : right → left. "-" : left → right (1:1).
    const [srcTbl, srcCols, tgtTbl, tgtCols] =
      op === '<'
        ? [right.table, right.columns, left.table, left.columns]
        : [left.table, left.columns, right.table, right.columns];

    this.pendingRefs.push({
      name,
      sourceTable: srcTbl.qualified,
      sourceNamespace: srcTbl.namespace,
      sourceColumns: srcCols,
      targetTable: tgtTbl.qualified,
      targetColumns: tgtCols,
      op,
      onDelete,
      onUpdate,
      comment,
      range: { from: startTok.from, to: this.peek().from },
    });
  }

  /**
   * Parse a `QualName "." Ident` or `QualName "." "(" Ident+ ")"` reference.
   * The table QualName may itself be `namespace.table`, so we collect all
   * dot-separated identifiers and treat the trailing one(s) as columns.
   */
  private parseColRefList(): {
    table: { qualified: string; namespace: string; name: string };
    columns: string[];
  } | null {
    const first = this.parseIdent();
    if (first === null) return null;
    const segments = [first];
    const columns: string[] = [];
    while (this.at('dot')) {
      this.next(); // '.'
      if (this.at('lparen')) {
        this.next();
        while (!this.at('rparen') && !this.at('eof')) {
          if (this.at('comma')) {
            this.next();
            continue;
          }
          const c = this.parseIdent();
          if (c) columns.push(c);
          else this.next();
        }
        this.eat('rparen');
        break;
      }
      const seg = this.parseIdent();
      if (seg === null) break;
      segments.push(seg);
    }
    if (columns.length === 0) {
      // The trailing segment is the single column.
      const col = segments.pop();
      if (col === undefined) return null;
      columns.push(col);
    }
    return { table: this.segmentsToTable(segments), columns };
  }

  private segmentsToTable(segments: string[]): {
    qualified: string;
    namespace: string;
    name: string;
  } {
    if (segments.length >= 2) {
      const namespace = segments[0]!;
      const name = segments.slice(1).join('.');
      return { qualified: `${namespace}.${name}`, namespace, name };
    }
    const name = segments[0] ?? '';
    return {
      qualified: `${this.currentNamespace}.${name}`,
      namespace: this.currentNamespace,
      name,
    };
  }

  private parseRefOp(): '>' | '<' | '-' | null {
    if (this.at('gt')) {
      this.next();
      return '>';
    }
    if (this.at('lt')) {
      this.next();
      return '<';
    }
    if (this.at('dash')) {
      this.next();
      return '-';
    }
    return null;
  }

  // ── group ──
  private parseGroup() {
    this.next(); // 'group'
    const name = this.parseIdent();
    if (!name) {
      this.recover();
      return;
    }
    let color: string | undefined;
    if (this.at('lbrack')) {
      const settings = this.parseSettingsBlock();
      color = settings.find((s) => s.key === 'color')?.value;
    }
    const tables: string[] = [];
    if (this.eat('lbrace')) {
      while (!this.at('rbrace') && !this.at('eof')) {
        const t = this.parseIdent();
        if (t) tables.push(t);
        else this.next();
      }
      this.eat('rbrace');
    }
    this.pendingGroups.push({ name, color, tables });
  }

  // ── standalone note ──
  private parseStandaloneNote() {
    this.next(); // 'note'
    const name = this.parseIdent();
    const note: StickyNote = {
      id: newNoteId(),
      text: '',
      pos: { x: 0, y: 0 },
      size: { w: 240, h: 120 },
      color: '#fde68a',
    };
    if (this.eat('lbrace')) {
      const v = this.peek();
      if (v.kind === 'tstring' || v.kind === 'string' || v.kind === 'dstring') {
        note.text = v.value;
        this.next();
      }
      this.eat('rbrace');
    }
    void name;
    this.schema.notes.push(note);
  }

  // ── shared: qualified names & idents ──
  private parseIdent(): string | null {
    const t = this.peek();
    if (t.kind === 'ident' || t.kind === 'dstring') {
      this.next();
      return t.value;
    }
    return null;
  }

  private parseQualName(): { namespace: string; name: string } {
    const parts = this.parseQualNameParts();
    if (!parts) return { namespace: this.currentNamespace, name: '' };
    return { namespace: parts.namespace, name: parts.name };
  }

  private parseQualNameParts(): { qualified: string; namespace: string; name: string } | null {
    const first = this.parseIdent();
    if (first === null) return null;
    if (this.at('dot')) {
      this.next();
      const second = this.parseIdent();
      if (second !== null) {
        return { qualified: `${first}.${second}`, namespace: first, name: second };
      }
    }
    // single name → current namespace; may also be an alias
    return {
      qualified: `${this.currentNamespace}.${first}`,
      namespace: this.currentNamespace,
      name: first,
    };
  }

  // ── settings block: "[" Setting ("," Setting)* "]" ──
  private parseSettingsBlock(): Setting[] {
    const settings: Setting[] = [];
    this.eat('lbrack');
    while (!this.at('rbrack') && !this.at('eof')) {
      if (this.at('comma')) {
        this.next();
        continue;
      }
      const s = this.parseSetting();
      if (s) settings.push(s);
      else this.next();
    }
    this.eat('rbrack');
    return settings;
  }

  private parseSetting(): Setting | null {
    const t = this.peek();
    if (t.kind !== 'ident') return null;
    const word = t.value.toLowerCase();

    // multi-word flags
    if (
      word === 'not' &&
      this.peek(1).kind === 'ident' &&
      this.peek(1).value.toLowerCase() === 'null'
    ) {
      this.next();
      this.next();
      return { key: 'not null' };
    }
    if (
      word === 'primary' &&
      this.peek(1).kind === 'ident' &&
      this.peek(1).value.toLowerCase() === 'key'
    ) {
      this.next();
      this.next();
      return { key: 'pk' };
    }

    // flag settings (no value)
    if (['pk', 'increment', 'null', 'unique'].includes(word)) {
      this.next();
      return { key: word };
    }

    // key : value settings
    if (
      [
        'default',
        'note',
        'check',
        'generated',
        'identity',
        'collate',
        'color',
        'ref',
        'name',
        'type',
        'where',
        'include',
        'delete',
        'update',
      ].includes(word)
    ) {
      this.next(); // key
      this.eat('colon');
      return this.parseSettingValue(word, t.from, t.to);
    }

    // unknown key — consume it (and an optional : value) and flag
    this.next();
    this.diag('error', 'PGL003', `Unknown setting "${t.value}"`, t.from, t.to);
    if (this.eat('colon')) this.next();
    return null;
  }

  private parseSettingValue(key: string, from: number, to: number): Setting {
    if (key === 'ref') {
      const ref = this.parseInlineRef();
      return { key, ref: ref ?? undefined };
    }
    if (key === 'identity') {
      // "always" | "by default"
      const w = this.peek();
      if (w.kind === 'ident' && w.value.toLowerCase() === 'always') {
        this.next();
        return { key, value: 'always' };
      }
      if (w.kind === 'ident' && w.value.toLowerCase() === 'by') {
        this.next();
        if (this.atKeyword('default')) this.next();
        return { key, value: 'by default' };
      }
      return { key, value: 'by default' };
    }
    if (key === 'default') {
      return { key, value: this.parseDefaultValue() };
    }
    if (key === 'include') {
      // "(" Ident+ ")"
      const cols: string[] = [];
      if (this.at('lparen')) {
        this.next();
        while (!this.at('rparen') && !this.at('eof')) {
          if (this.at('comma')) {
            this.next();
            continue;
          }
          const c = this.parseIdent();
          if (c) cols.push(c);
          else this.next();
        }
        this.eat('rparen');
      }
      return { key, value: cols.join(',') };
    }
    if (key === 'delete' || key === 'update') {
      return { key, value: this.parseRefActionWords() };
    }
    // generic: string / hexcolor / ident / number / raw
    const v = this.peek();
    if (v.kind === 'string' || v.kind === 'dstring' || v.kind === 'tstring') {
      this.next();
      return { key, value: v.value };
    }
    if (v.kind === 'hexcolor') {
      this.next();
      return { key, value: v.value };
    }
    if (v.kind === 'raw') {
      this.next();
      return { key, value: v.value };
    }
    if (v.kind === 'ident' || v.kind === 'number') {
      this.next();
      return { key, value: v.value };
    }
    this.diag('error', 'PGL001', `Expected a value for "${key}"`, from, to);
    return { key };
  }

  private parseRefActionWords(): string {
    // cascade | restrict | no action | set null | set default
    const w = this.peek();
    if (w.kind !== 'ident') return 'no action';
    const first = w.value.toLowerCase();
    this.next();
    if (first === 'set' && this.at('ident')) {
      const second = this.peek().value.toLowerCase();
      if (second === 'null' || second === 'default') {
        this.next();
        return `set ${second}`;
      }
    }
    if (first === 'no' && this.atKeyword('action')) {
      this.next();
      return 'no action';
    }
    return first;
  }

  private parseDefaultValue(): string {
    const v = this.peek();
    if (v.kind === 'string') {
      this.next();
      return `'${v.value.replace(/'/g, "''")}'`; // store as a SQL string literal
    }
    if (v.kind === 'dstring') {
      this.next();
      return `'${v.value.replace(/'/g, "''")}'`;
    }
    if (v.kind === 'raw') {
      this.next();
      return v.value; // raw SQL expression
    }
    if (v.kind === 'number') {
      this.next();
      return v.value;
    }
    if (v.kind === 'ident') {
      const w = v.value.toLowerCase();
      if (w === 'true' || w === 'false' || w === 'null') {
        this.next();
        return w;
      }
      this.next();
      return v.value;
    }
    return '';
  }

  private parseInlineRef(): Omit<
    PendingRef,
    'sourceTable' | 'sourceNamespace' | 'sourceColumns' | 'sourceColumnId'
  > | null {
    const op = this.parseRefOp();
    if (!op) return null;
    const target = this.parseColRefList();
    if (!target || target.columns.length !== 1) return null;
    const parts = target.table;
    const col = target.columns[0]!;

    let onDelete: RefAction = 'no_action';
    let onUpdate: RefAction = 'no_action';
    let name: string | undefined;
    let comment: string | undefined;
    if (this.at('lbrack')) {
      const settings = this.parseSettingsBlock();
      for (const s of settings) {
        if (s.key === 'delete' && s.value) onDelete = REF_ACTIONS[s.value] ?? 'no_action';
        else if (s.key === 'update' && s.value) onUpdate = REF_ACTIONS[s.value] ?? 'no_action';
        else if (s.key === 'name' && s.value) name = s.value;
        else if (s.key === 'note' && s.value) comment = s.value;
      }
    }

    return {
      name,
      targetTable: parts.qualified,
      targetColumns: [col],
      op,
      onDelete,
      onUpdate,
      comment,
      range: { from: parts.namespace.length, to: parts.name.length },
    };
  }

  // ── resolution passes ──
  private resolveEnumTypes() {
    // Attach udtId to columns whose type name matches a declared enum.
    for (const table of this.schema.tables) {
      for (const col of table.columns) {
        if (isBuiltinType(col.type.name)) continue;
        const en = this.schema.enums.find(
          (e) => e.name.toLowerCase() === col.type.name.toLowerCase(),
        );
        if (en) col.type.udtId = en.id;
      }
    }
    // Emit PGL004 only for type names that are neither builtin nor a declared enum.
    for (const u of this.pendingUnknownTypes) {
      if (!this.isDeclaredEnum(u.name) && !isBuiltinType(u.name)) {
        this.diag('info', 'PGL004', `Unknown type "${u.name}" (preserved verbatim)`, u.from, u.to);
      }
    }
  }

  private findTable(qualified: string): Table | undefined {
    // qualified may be "ns.name" or resolved from an alias
    const resolved = this.aliasToName.get(qualified) ?? qualified;
    const [ns, nm] = splitQual(resolved);
    return this.schema.tables.find(
      (t) =>
        t.namespace.toLowerCase() === ns.toLowerCase() && t.name.toLowerCase() === nm.toLowerCase(),
    );
  }

  private resolveRefs() {
    this.resolveEnumTypes();
    // Resolve index key column names → ids first.
    for (const ix of this.schema.indexes) {
      const table = this.schema.tables.find((t) => t.id === ix.table);
      if (!table) continue;
      ix.keys = ix.keys.map((k) => {
        if (k.kind !== 'column') return k;
        const col = table.columns.find(
          (c) => c.name.toLowerCase() === String(k.column).toLowerCase(),
        );
        return col ? { ...k, column: col.id } : k;
      });
      // primaryKey entries currently hold names → convert
    }
    // Convert composite-PK column names (set in parseIndexesBlock) into ids.
    for (const table of this.schema.tables) {
      table.primaryKey = table.primaryKey.map((c) => {
        // already an id if it was set from a column [pk]; names come from indexes block
        const byId = table.columns.find((col) => col.id === c);
        if (byId) return byId.id;
        const byName = table.columns.find(
          (col) => col.name.toLowerCase() === String(c).toLowerCase(),
        );
        return byName ? byName.id : c;
      });
    }

    for (const p of this.pendingRefs) {
      const srcTable = this.findTable(p.sourceTable);
      const tgtTable = this.findTable(p.targetTable);
      if (!tgtTable) {
        this.diag(
          'error',
          'PGL008',
          `Ref target table "${p.targetTable}" not found`,
          p.range.from,
          p.range.to,
        );
        continue;
      }
      if (!srcTable) {
        this.diag(
          'error',
          'PGL008',
          `Ref source table "${p.sourceTable}" not found`,
          p.range.from,
          p.range.to,
        );
        continue;
      }
      if (p.sourceColumns.length !== p.targetColumns.length) {
        this.diag(
          'error',
          'PGL010',
          'Composite ref column count mismatch',
          p.range.from,
          p.range.to,
        );
        continue;
      }

      const srcCols = this.resolveColumns(srcTable, p.sourceColumns, p.sourceColumnId);
      const tgtCols = this.resolveColumns(tgtTable, p.targetColumns);
      if (!srcCols || !tgtCols) {
        this.diag('error', 'PGL009', 'Ref column not found', p.range.from, p.range.to);
        continue;
      }

      const rel: Relationship = {
        id: newRelId(),
        name: p.name,
        sourceTable: srcTable.id,
        sourceColumns: srcCols,
        targetTable: tgtTable.id,
        targetColumns: tgtCols,
        onDelete: p.onDelete,
        onUpdate: p.onUpdate,
      };
      if (p.comment) rel.comment = p.comment;
      this.schema.relationships.push(rel);
    }
  }

  private resolveColumns(
    table: Table,
    names: string[],
    knownFirstId?: ColumnId,
  ): ColumnId[] | null {
    const ids: ColumnId[] = [];
    for (let i = 0; i < names.length; i++) {
      if (i === 0 && knownFirstId) {
        ids.push(knownFirstId);
        continue;
      }
      const col = table.columns.find((c) => c.name.toLowerCase() === names[i]!.toLowerCase());
      if (!col) return null;
      ids.push(col.id);
    }
    return ids;
  }

  private resolveGroups() {
    for (const g of this.pendingGroups) {
      const group: TableGroup = {
        id: newGroupId(),
        name: g.name,
        color: g.color ?? '#94a3b8',
      };
      this.schema.groups.push(group);
      for (const tname of g.tables) {
        const t =
          this.findTable(`${this.currentNamespace}.${tname}`) ?? this.findTableByBareName(tname);
        if (t) t.groupId = group.id;
        else this.diag('error', 'PGL013', `Group references unknown table "${tname}"`, 0, 0);
      }
    }
  }

  private findTableByBareName(name: string): Table | undefined {
    const nm = name.toLowerCase();
    return this.schema.tables.find((t) => t.name.toLowerCase() === nm);
  }
}

const TOP_KEYWORDS = new Set(['project', 'namespace', 'enum', 'table', 'ref', 'group', 'note']);

interface Setting {
  key: string;
  value?: string;
  ref?: Omit<PendingRef, 'sourceTable' | 'sourceNamespace' | 'sourceColumns' | 'sourceColumnId'>;
}

function splitQual(qualified: string): [string, string] {
  const idx = qualified.indexOf('.');
  if (idx < 0) return ['public', qualified];
  return [qualified.slice(0, idx), qualified.slice(idx + 1)];
}
