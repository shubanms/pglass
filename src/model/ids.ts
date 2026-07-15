// Stable ID generation. IDs are content-independent so they survive renames
// and keep relationships/selection attached across edits. See PRD §4.
import { customAlphabet } from 'nanoid';
import type { ColumnId, EnumId, GroupId, IndexId, NoteId, RelId, TableId } from './types.ts';

// URL-safe, no ambiguous chars, 8 chars — collision-safe at our scale.
const nano = customAlphabet('123456789abcdefghijkmnopqrstuvwxyz', 8);

export const newTableId = (): TableId => `t_${nano()}` as TableId;
export const newColumnId = (): ColumnId => `c_${nano()}` as ColumnId;
export const newRelId = (): RelId => `r_${nano()}` as RelId;
export const newIndexId = (): IndexId => `i_${nano()}` as IndexId;
export const newEnumId = (): EnumId => `e_${nano()}` as EnumId;
export const newNoteId = (): NoteId => `n_${nano()}` as NoteId;
export const newGroupId = (): GroupId => `g_${nano()}` as GroupId;
