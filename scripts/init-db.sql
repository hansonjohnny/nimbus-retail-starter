-- Schemas per service. In production, each service connects with a credential scoped to its own schema.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS cart;
CREATE SCHEMA IF NOT EXISTS orders;

-- auth schema
CREATE TABLE IF NOT EXISTS auth.users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- catalog schema
CREATE TABLE IF NOT EXISTS catalog.products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  stock       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO catalog.products (id, name, description, price_cents, stock) VALUES
  ('prod-001', 'Wireless Headphones', 'Over-ear bluetooth headphones', 12999, 50),
  ('prod-002', 'Mechanical Keyboard', 'Hot-swappable RGB keyboard', 14999, 30),
  ('prod-003', 'Standing Desk', 'Electric height-adjustable desk', 49900, 12),
  ('prod-004', 'Desk Lamp', 'Warm-light LED with USB-C charging', 4500, 80),
  ('prod-005', 'Notebook Set', 'A5 dotted, pack of three', 1899, 200)
ON CONFLICT (id) DO NOTHING;

-- cart schema
CREATE TABLE IF NOT EXISTS cart.carts (
  user_id    UUID PRIMARY KEY,
  items      JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- orders schema
CREATE TABLE IF NOT EXISTS orders.orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  items       JSONB NOT NULL,
  total_cents INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'CREATED',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders.orders(user_id);
