CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK(role IN ('user', 'admin', 'superadmin')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  total_score REAL,
  ai_feedback TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  shot_number INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  score REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_estimate REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY,
  distance INTEGER DEFAULT 10,
  shots_per_series INTEGER DEFAULT 5,
  target_type TEXT DEFAULT 'paper' CHECK(target_type IN ('monitor', 'paper')),
  training_type TEXT DEFAULT 'laser' CHECK(training_type IN ('live', 'laser')),
  openai_key TEXT DEFAULT '',
  ai_provider TEXT DEFAULT 'openai' CHECK(ai_provider IN ('openai', 'claude')),
  anthropic_key TEXT DEFAULT '',
  camera_device_id TEXT DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id)
);
