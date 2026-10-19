PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  variants TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  total_cents INTEGER NOT NULL,
  payment TEXT NOT NULL CHECK (payment IN ('cash', 'gcash')),
  voided INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  daily_seq INTEGER NOT NULL DEFAULT 1,
  received_cents INTEGER,
  change_cents INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  variant TEXT
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  low_threshold REAL NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  delta REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('delivery', 'adjustment', 'waste')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  menu_item_id INTEGER NOT NULL UNIQUE REFERENCES menu_items(id),
  steps TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  ingredient TEXT NOT NULL,
  qty REAL,
  unit TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  due_day INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  end_date TEXT,
  alert_days INTEGER NOT NULL DEFAULT 3,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  series_id INTEGER,
  source_bill_id INTEGER
);

CREATE TABLE IF NOT EXISTS payables (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY,
  lender TEXT NOT NULL,
  principal_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  installment_cents INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  due_day INTEGER NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  end_date TEXT,
  alert_days INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS loan_payments (
  id INTEGER PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  amount_cents INTEGER NOT NULL,
  paid_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS salaries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category_id ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_stock_item_id ON stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_recipe_lines_recipe_id ON recipe_lines(recipe_id);
CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON loan_payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_salaries_paid_at ON salaries(paid_at);
