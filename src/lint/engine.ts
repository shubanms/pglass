// Lint engine: runs enabled rules and returns diagnostics grouped-ready.
// See PRD §10.
import type { Diagnostic, Schema } from '../model/types.ts';
import { CORRECTNESS_RULES } from './rules/correctness.ts';
import { DESIGN_RULES } from './rules/design.ts';
import { PERFORMANCE_RULES } from './rules/performance.ts';
import { SECURITY_RULES } from './rules/security.ts';
import type { LintConfig, LintRule } from './types.ts';

export const ALL_RULES: LintRule[] = [
  ...CORRECTNESS_RULES,
  ...PERFORMANCE_RULES,
  ...DESIGN_RULES,
  ...SECURITY_RULES,
];

export const RULES_BY_CODE = new Map(ALL_RULES.map((r) => [r.code, r] as const));

export function isEnabled(rule: LintRule, config: LintConfig): boolean {
  return config[rule.code] ?? rule.defaultOn;
}

/** Run all enabled rules over the schema. Rule crashes are isolated. */
export function lint(schema: Schema, config: LintConfig = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const rule of ALL_RULES) {
    if (!isEnabled(rule, config)) continue;
    try {
      out.push(...rule.check(schema));
    } catch {
      // a broken rule must never take down the linter
    }
  }
  return out;
}

const SEVERITY_ORDER: Record<Diagnostic['severity'], number> = { error: 0, warning: 1, info: 2 };

/** Sort by severity then code for a stable panel display. */
export function sortDiagnostics(diags: Diagnostic[]): Diagnostic[] {
  return [...diags].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
  );
}
