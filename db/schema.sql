PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- USUARIOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL UNIQUE,
  password  TEXT NOT NULL,
  fullname  TEXT,
  role      TEXT NOT NULL DEFAULT 'operador', -- admin | operador
  active    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- CONFIGURACIONES (listas editables: una fila por ítem)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind     TEXT NOT NULL,   -- tramite | paso | oficina | operador | autor
  parent   TEXT,            -- para pasos: nombre del trámite padre
  value    TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_config_kind ON config_items(kind, parent);

-- ---------------------------------------------------------------------------
-- CASOS (ticket padre)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases (
  id                INTEGER PRIMARY KEY,
  subject           TEXT NOT NULL,
  description       TEXT,
  general_status    TEXT NOT NULL DEFAULT 'Nuevo',
  status_mode       TEXT NOT NULL DEFAULT 'auto',
  priority          TEXT,
  owner             TEXT,
  team              TEXT,
  author            TEXT,
  module            TEXT,
  system            TEXT,
  case_type         TEXT NOT NULL DEFAULT 'grouped',
  tags              TEXT,
  sla_hours         INTEGER,
  observations      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  target_at         TEXT,
  resolved_at       TEXT,
  closed_at         TEXT,
  last_activity_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_cases_status   ON cases(general_status);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_cases_owner    ON cases(owner);
CREATE INDEX IF NOT EXISTS idx_cases_module   ON cases(module);
CREATE INDEX IF NOT EXISTS idx_cases_system   ON cases(system);
CREATE INDEX IF NOT EXISTS idx_cases_type     ON cases(case_type);

-- ---------------------------------------------------------------------------
-- TICKETS (hijos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id               INTEGER PRIMARY KEY,
  case_id          INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  project          TEXT,
  ticket_type      TEXT,
  subject          TEXT NOT NULL,
  description      TEXT,
  status           TEXT,
  priority         TEXT,
  priority_assigned TEXT,
  owner            TEXT,
  author           TEXT,
  last_updated_by  TEXT,
  category         TEXT,
  target_version   TEXT,
  module           TEXT,
  item_type        TEXT,
  office           TEXT,
  office_cc        TEXT,
  contact_channel  TEXT,
  system_module    TEXT,
  procedure_nums   TEXT,
  environment      TEXT,
  procedure_name   TEXT,
  motives          TEXT,
  motive           TEXT,
  motive_interop   TEXT,
  motive_mirc      TEXT,
  motives_varios   TEXT,
  suac_code        TEXT,
  request_number   TEXT,
  act_type         TEXT,
  reference_item   TEXT,
  deployed_prod    TEXT,
  more_citizen_info TEXT,
  facebook_user    TEXT,
  frequency        TEXT,
  cuil             TEXT,
  internet_speed   TEXT,
  bandeja          TEXT,
  step             TEXT,
  section          TEXT,
  motives_sisol    TEXT,
  act_type_sisol   TEXT,
  motive_rcd       TEXT,
  module_rcd       TEXT,
  status_sisol     TEXT,
  system           TEXT,
  motives_rc_cba   TEXT,
  module_gt        TEXT,
  post_impl        TEXT,
  agent            TEXT,
  private          TEXT,
  files            TEXT,
  is_critical      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT,
  started_at       TEXT,
  finished_at      TEXT,
  closed_at        TEXT,
  updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_case     ON tickets(case_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_owner    ON tickets(owner);
CREATE INDEX IF NOT EXISTS idx_tickets_module   ON tickets(module);
CREATE INDEX IF NOT EXISTS idx_tickets_type     ON tickets(ticket_type);
CREATE INDEX IF NOT EXISTS idx_tickets_subject  ON tickets(subject);

-- ---------------------------------------------------------------------------
-- ACTIVIDADES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ticket_id   INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  actor       TEXT,
  message     TEXT,
  metadata    TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activities_case ON activities(case_id, occurred_at);

-- ---------------------------------------------------------------------------
-- COMENTARIOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  author     TEXT,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_case ON comments(case_id, created_at);

-- ---------------------------------------------------------------------------
-- ARCHIVOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  path       TEXT,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_case ON files(case_id);

-- ---------------------------------------------------------------------------
-- Vista de métricas por caso
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS case_metrics AS
SELECT
  c.id                                           AS case_id,
  COUNT(t.id)                                    AS total_children,
  SUM(CASE WHEN t.status IN ('Asignada','Nueva','Abierta','Nuevo') THEN 1 ELSE 0 END)  AS open_children,
  SUM(CASE WHEN t.status = 'En Progreso' THEN 1 ELSE 0 END)                            AS inprogress_children,
  SUM(CASE WHEN t.status IN ('Pendiente','Verificar resolución') THEN 1 ELSE 0 END)    AS pending_children,
  SUM(CASE WHEN t.status IN ('Cerrada','Cerrado','Resuelta','Resuelto') THEN 1 ELSE 0 END) AS closed_children,
  SUM(CASE WHEN t.is_critical = 1 THEN 1 ELSE 0 END) AS critical_children,
  MIN(t.created_at)                              AS first_child_at,
  MAX(COALESCE(t.updated_at, t.created_at))      AS last_child_activity_at
FROM cases c
LEFT JOIN tickets t ON t.case_id = c.id
GROUP BY c.id;
