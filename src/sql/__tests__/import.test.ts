import { describe, expect, it } from 'vitest';
import { importSql } from '../import/ddl-parser.ts';
import { splitStatements } from '../import/tokenizer.ts';

// A hand-written excerpt in the shape real pg_dump --schema-only produces:
// SET noise, sequences + nextval defaults (legacy serial), PK/FK emitted as
// ALTER ... ADD CONSTRAINT, comments, an extension, and a preserved view.
const PGDUMP = `
--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE TYPE public.mood AS ENUM (
    'happy',
    'sad',
    'meh'
);

CREATE TABLE public.customers (
    id integer NOT NULL,
    email public.citext NOT NULL,
    name character varying(120),
    mood public.mood DEFAULT 'meh'::public.mood NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.customers OWNER TO postgres;

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1;

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);

CREATE TABLE public.orders (
    id bigint NOT NULL,
    customer_id integer NOT NULL,
    total numeric(10,2) NOT NULL,
    note text
);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_email_key UNIQUE (email);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE;

CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id, id DESC);

CREATE VIEW public.recent_orders AS
    SELECT id, customer_id FROM public.orders WHERE note IS NULL;

COMMENT ON TABLE public.customers IS 'People who buy things';
COMMENT ON COLUMN public.customers.email IS 'unique login';
`;

describe('SQL tokenizer', () => {
  it('splits statements, ignoring semicolons inside strings and parens', () => {
    const stmts = splitStatements(
      "CREATE TABLE t (a text DEFAULT 'x;y', b int CHECK (b > (0)));\nSELECT 1;",
    );
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('CREATE TABLE');
  });

  it('does not split inside dollar-quoted bodies', () => {
    const stmts = splitStatements(
      'CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql;\nSELECT 2;',
    );
    expect(stmts).toHaveLength(2);
  });
});

describe('pg_dump import', () => {
  const { schema, diagnostics } = importSql(PGDUMP);

  it('imports with no error diagnostics', () => {
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('captures the extension and preserves the view', () => {
    expect(schema.meta.extensions).toContain('citext');
    expect(schema.meta.rawObjects?.some((r) => r.kind === 'view')).toBe(true);
  });

  it('parses both tables with all columns', () => {
    expect(schema.tables.map((t) => t.name).sort()).toEqual(['customers', 'orders']);
    const customers = schema.tables.find((t) => t.name === 'customers')!;
    expect(customers.columns.map((c) => c.name)).toEqual([
      'id',
      'email',
      'name',
      'mood',
      'created_at',
    ]);
  });

  it('normalizes the sequence + nextval trio into identity', () => {
    const id = schema.tables
      .find((t) => t.name === 'customers')!
      .columns.find((c) => c.name === 'id')!;
    expect(id.identity).toBe('by_default');
    expect(id.default).toBeUndefined(); // nextval consumed, not kept as a default
  });

  it('resolves an enum-typed column to the declared enum', () => {
    const mood = schema.tables
      .find((t) => t.name === 'customers')!
      .columns.find((c) => c.name === 'mood')!;
    expect(mood.type.name).toBe('mood');
    expect(mood.type.udtId).toBeTruthy();
    expect(schema.enums[0]?.values).toEqual(['happy', 'sad', 'meh']);
  });

  it('applies pg_dump ALTER-style PRIMARY KEY and UNIQUE', () => {
    const customers = schema.tables.find((t) => t.name === 'customers')!;
    expect(customers.primaryKey).toHaveLength(1);
    expect(customers.columns.find((c) => c.name === 'email')?.unique).toBe(true);
  });

  it('applies the ALTER-style FOREIGN KEY with ON DELETE CASCADE', () => {
    expect(schema.relationships).toHaveLength(1);
    const fk = schema.relationships[0]!;
    expect(fk.onDelete).toBe('cascade');
    const orders = schema.tables.find((t) => t.name === 'orders')!;
    expect(fk.sourceTable).toBe(orders.id);
  });

  it('parses the composite index with a DESC key', () => {
    expect(schema.indexes).toHaveLength(1);
    const ix = schema.indexes[0]!;
    expect(ix.keys).toHaveLength(2);
    const second = ix.keys[1]!;
    expect(second.kind === 'column' && second.sort).toBe('desc');
  });

  it('attaches comments to the table and column', () => {
    const customers = schema.tables.find((t) => t.name === 'customers')!;
    expect(customers.comment).toBe('People who buy things');
    expect(customers.columns.find((c) => c.name === 'email')?.comment).toBe('unique login');
  });

  it('canonicalizes character varying → varchar', () => {
    const name = schema.tables
      .find((t) => t.name === 'customers')!
      .columns.find((c) => c.name === 'name')!;
    expect(name.type.name).toBe('varchar');
    expect(name.type.args).toEqual([120]);
  });
});
