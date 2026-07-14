// Hand-written .pgl fixtures used by the round-trip tests. Each is in canonical
// form (as produced by the printer). The round-trip test asserts, for every
// fixture, that print(parse(x)) === x exactly.
export const FIXTURES: Record<string, string> = {
  minimal: `table users {
  id     bigint [pk, increment]
  email  text
}
`,

  types: `table widgets {
  id       uuid         [pk, default: \`gen_random_uuid()\`]
  name     varchar(120) [not null]
  price    numeric(10,2)
  tags     text[]
  meta     jsonb
  created  timestamptz  [not null, default: \`now()\`]
}
`,

  enum_and_ref: `enum order_status {
  pending
  paid
  shipped
  cancelled [note: 'terminal state']
}

table orders [color: #059669] {
  id       bigint       [pk, increment]
  user_id  uuid         [not null, ref: > users.id [delete: cascade]]
  status   order_status [not null, default: 'pending']
}

table users {
  id  uuid [pk, default: \`gen_random_uuid()\`]
}
`,

  composite_pk_and_checks: `table order_items {
  order_id    bigint  [not null]
  product_id  bigint  [not null]
  qty         integer [not null, default: 1]

  indexes {
    (order_id, product_id) [pk]
  }

  checks {
    'qty > 0' [name: 'order_items_qty_positive']
  }
}
`,

  indexes_variety: `table users {
  id          uuid        [pk, default: \`gen_random_uuid()\`]
  email       citext      [not null, unique]
  full_name   varchar(120)
  created_at  timestamptz [not null, default: \`now()\`]
  deleted_at  timestamptz

  indexes {
    (email)            [unique, name: 'users_email_key']
    (created_at desc)  [where: 'deleted_at is null', name: 'users_active_recent']
    \`lower(full_name)\` [type: gin]
  }

  note: 'Soft-deleted via deleted_at'
}
`,

  composite_pk_with_inline_fks: `table order_items {
  order_id    bigint [not null, ref: > orders.id [delete: cascade]]
  product_id  bigint [not null, ref: > products.id [delete: restrict]]

  indexes {
    (order_id, product_id) [pk]
  }
}

table orders {
  id  bigint [pk, increment]
}

table products {
  id  bigint [pk, increment]
}
`,

  standalone_composite_ref: `table memberships {
  org_id   bigint [not null]
  user_id  bigint [not null]

  indexes {
    (org_id, user_id) [pk]
  }
}

table org_users {
  org_id   bigint [not null]
  user_id  bigint [not null]

  indexes {
    (org_id, user_id) [pk]
  }
}

ref: org_users.(org_id, user_id) > memberships.(org_id, user_id)
`,

  group: `table order_items {
  id  bigint [pk, increment]
}

table orders {
  id  bigint [pk, increment]
}

group commerce [color: #059669] {
  order_items
  orders
}
`,

  project_header: `project 'Acme Store' {
  description: 'Order + inventory schema'
}

table users {
  id  bigint [pk, increment]
}
`,
};
