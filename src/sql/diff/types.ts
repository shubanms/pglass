// CONTRACT — migration diff engine types. See PRD §9.1.

export type DiffKind =
  | 'create_schema'
  | 'drop_schema'
  | 'create_enum'
  | 'drop_enum'
  | 'add_enum_value'
  | 'rename_enum_value'
  | 'create_table'
  | 'drop_table'
  | 'rename_table'
  | 'add_column'
  | 'drop_column'
  | 'rename_column'
  | 'alter_column_type'
  | 'alter_column_null'
  | 'alter_column_default'
  | 'alter_column_identity'
  | 'add_pk'
  | 'drop_pk'
  | 'add_fk'
  | 'drop_fk'
  | 'add_unique'
  | 'drop_unique'
  | 'add_check'
  | 'drop_check'
  | 'create_index'
  | 'drop_index'
  | 'set_comment';

export type Risk = 'safe' | 'lock' | 'destructive' | 'lossy';

export interface DiffOp {
  kind: DiffKind;
  sql: string;
  risk: Risk;
  warning?: string;
  /** ids this op depends on having run first */
  dependsOn: string[];
  id: string;
  /** ordering phase (PRD §9.2), 1-based */
  phase: number;
}

export interface Ambiguity {
  message: string;
  options: { label: string; ops: DiffOp[] }[];
}

export interface DiffResult {
  ops: DiffOp[];
  ambiguities: Ambiguity[];
  hasDataLoss: boolean;
}

export interface DiffOptions {
  /** generate CONCURRENTLY for index creation and split into a separate txn */
  concurrentIndexes: boolean;
  /** wrap in BEGIN/COMMIT (cannot combine with concurrentIndexes) */
  transactional: boolean;
  /** how to detect renames */
  renameStrategy: 'by_id' | 'heuristic' | 'never';
  /** emit DROP statements at all */
  includeDrops: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  concurrentIndexes: false,
  transactional: true,
  renameStrategy: 'by_id',
  includeDrops: true,
};

// Phase numbers from §9.2.
export const PHASE = {
  create_schema: 1,
  create_enum: 2,
  add_enum_value: 3,
  drop_fk: 4,
  drop_index: 5,
  create_table: 6,
  rename: 7,
  add_column: 8,
  alter_type: 9,
  alter_null: 10,
  alter_default: 11,
  drop_column: 12,
  add_pk: 13,
  create_index: 14,
  add_fk: 15,
  add_check: 16,
  comment: 17,
  drop_table: 18,
  drop_enum: 19,
} as const;
