// Linter contract. See PRD §10. Every rule is a self-contained module producing
// Diagnostics; rules are individually toggleable and persisted in settings.
import type { Diagnostic, Schema } from '../model/types.ts';

export type LintCategory = 'correctness' | 'performance' | 'design' | 'security';

export interface LintRule {
  code: string;
  name: string;
  category: LintCategory;
  severity: Diagnostic['severity'];
  description: string;
  /** whether the rule is enabled unless the user turns it off */
  defaultOn: boolean;
  check(schema: Schema): Diagnostic[];
}

/** code → enabled?; absent codes fall back to the rule's defaultOn. */
export type LintConfig = Record<string, boolean>;
