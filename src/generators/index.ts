// Registry of all code generators. Each is a pure (schema) => string, except
// the faker-based seed generator which is async (dynamic faker import).
import type { Schema } from '../model/types.ts';
import { exportDDL } from '../sql/export/ddl-writer.ts';
import { generateDbml } from './dbml.ts';
import { generateDrizzle } from './drizzle.ts';
import { generateJsonSchema } from './json-schema.ts';
import { generateMarkdown } from './markdown.ts';
import { generateMermaid } from './mermaid.ts';
import { generatePlantUml } from './plantuml.ts';
import { generatePrisma } from './prisma.ts';
import { generateSeed } from './seed.ts';
import { generateSqlAlchemy } from './sqlalchemy.ts';
import { generateTypeOrm } from './typeorm.ts';
import { generateTypeScript } from './typescript.ts';
import { generateZod } from './zod.ts';

export interface GeneratorDef {
  id: string;
  label: string;
  language: string; // for the editor / syntax highlight hint
  filename: (name: string) => string;
  run: (schema: Schema) => string | Promise<string>;
}

export const GENERATORS: GeneratorDef[] = [
  {
    id: 'ddl',
    label: 'Postgres DDL',
    language: 'sql',
    filename: (n) => `${n}.sql`,
    run: (s) => exportDDL(s),
  },
  {
    id: 'prisma',
    label: 'Prisma',
    language: 'prisma',
    filename: () => 'schema.prisma',
    run: generatePrisma,
  },
  {
    id: 'drizzle',
    label: 'Drizzle',
    language: 'typescript',
    filename: () => 'schema.ts',
    run: generateDrizzle,
  },
  {
    id: 'sqlalchemy',
    label: 'SQLAlchemy',
    language: 'python',
    filename: () => 'models.py',
    run: generateSqlAlchemy,
  },
  {
    id: 'typeorm',
    label: 'TypeORM',
    language: 'typescript',
    filename: () => 'entities.ts',
    run: generateTypeOrm,
  },
  {
    id: 'zod',
    label: 'Zod',
    language: 'typescript',
    filename: () => 'schemas.ts',
    run: generateZod,
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    language: 'typescript',
    filename: () => 'types.ts',
    run: generateTypeScript,
  },
  {
    id: 'mermaid',
    label: 'Mermaid',
    language: 'mermaid',
    filename: (n) => `${n}.mmd`,
    run: generateMermaid,
  },
  {
    id: 'plantuml',
    label: 'PlantUML',
    language: 'plantuml',
    filename: (n) => `${n}.puml`,
    run: generatePlantUml,
  },
  { id: 'dbml', label: 'DBML', language: 'dbml', filename: (n) => `${n}.dbml`, run: generateDbml },
  {
    id: 'markdown',
    label: 'Markdown docs',
    language: 'markdown',
    filename: () => 'SCHEMA.md',
    run: generateMarkdown,
  },
  {
    id: 'json-schema',
    label: 'JSON Schema',
    language: 'json',
    filename: (n) => `${n}.schema.json`,
    run: generateJsonSchema,
  },
  {
    id: 'seed',
    label: 'Seed data',
    language: 'sql',
    filename: () => 'seed.sql',
    run: (s) => generateSeed(s),
  },
];

export {
  generateDbml,
  generateDrizzle,
  generateJsonSchema,
  generateMarkdown,
  generateMermaid,
  generatePlantUml,
  generatePrisma,
  generateSeed,
  generateSqlAlchemy,
  generateTypeOrm,
  generateTypeScript,
  generateZod,
};
