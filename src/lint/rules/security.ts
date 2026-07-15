// Security lint rules (PRD §10) — warnings / informational.
import type { Diagnostic } from '../../model/types.ts';
import type { LintRule } from '../types.ts';

const SECRET_RE = /password|passwd|secret|token|api_key/i;
const PII_RE = /\b(ssn|social_security|dob|date_of_birth|phone|address)\b/i;
const TENANT_RE = /^(tenant_id|org_id|organization_id|account_id)$/i;
const TEXTY = new Set(['text', 'varchar', 'char', 'citext']);

const L301: LintRule = {
  code: 'L301',
  name: 'Unhashed secret column',
  category: 'security',
  severity: 'warning',
  description: 'A password/secret/token column stored as text/varchar — is it hashed?',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (SECRET_RE.test(c.name) && TEXTY.has(c.type.name)) {
          out.push({
            severity: 'warning',
            code: 'L301',
            message: `"${t.name}.${c.name}" looks like a secret stored as ${c.type.name} — ensure it is hashed, not plaintext`,
            target: { kind: 'column', table: t.id, id: c.id },
          });
        }
      }
    }
    return out;
  },
};

const L302: LintRule = {
  code: 'L302',
  name: 'PII column',
  category: 'security',
  severity: 'info',
  description: 'A column that looks like personally-identifiable information — tag for compliance.',
  defaultOn: false,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (PII_RE.test(c.name) || /email/i.test(c.name)) {
          out.push({
            severity: 'info',
            code: 'L302',
            message: `"${t.name}.${c.name}" may be PII — consider encryption / retention policy`,
            target: { kind: 'column', table: t.id, id: c.id },
          });
        }
      }
    }
    return out;
  },
};

const L303: LintRule = {
  code: 'L303',
  name: 'Multi-tenant table without RLS',
  category: 'security',
  severity: 'warning',
  description:
    'A table with a tenant/org/account id but row-level security disabled risks leakage.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      const hasTenant = t.columns.some((c) => TENANT_RE.test(c.name));
      if (hasTenant && !t.rowLevelSecurity) {
        out.push({
          severity: 'warning',
          code: 'L303',
          message: `"${t.name}" has a tenant/org column but row-level security is off — multi-tenant leak risk`,
          target: { kind: 'table', id: t.id },
          fix: {
            title: 'Enable row-level security',
            apply: (s) => ({
              ...s,
              tables: s.tables.map((x) => (x.id === t.id ? { ...x, rowLevelSecurity: true } : x)),
            }),
          },
        });
      }
    }
    return out;
  },
};

export const SECURITY_RULES: LintRule[] = [L301, L302, L303];
