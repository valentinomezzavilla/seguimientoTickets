-- USUARIOS
CREATE TABLE IF NOT EXISTS users (
  id        SERIAL PRIMARY KEY,
  username  TEXT NOT NULL UNIQUE,
  password  TEXT NOT NULL,
  fullname  TEXT,
  role      TEXT NOT NULL DEFAULT 'operador',
  active    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CONFIGURACIONES
CREATE TABLE IF NOT EXISTS config_items (
  id       SERIAL PRIMARY KEY,
  kind     TEXT NOT NULL,
  parent   TEXT,
  value    TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_config_kind ON config_items(kind, parent);

-- CASOS (ticket padre)
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
  procedure_name    TEXT,
  step              TEXT,
  office            TEXT,
  case_type         TEXT NOT NULL DEFAULT 'grouped',
  tags              TEXT,
  sla_hours         INTEGER,
  observations      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  target_at         TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  last_activity_at  TIMESTAMPTZ
);

-- TRAMITES DEL CASO (varios por ticket padre)
CREATE TABLE IF NOT EXISTS case_procedures (
  id         SERIAL PRIMARY KEY,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (case_id, value)
);
CREATE INDEX IF NOT EXISTS idx_case_procedures_case  ON case_procedures(case_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_case_procedures_value ON case_procedures(value);

CREATE INDEX IF NOT EXISTS idx_cases_status   ON cases(general_status);
CREATE INDEX IF NOT EXISTS idx_cases_priority ON cases(priority);
CREATE INDEX IF NOT EXISTS idx_cases_owner    ON cases(owner);

-- TICKETS (hijos)
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
  is_critical      BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tickets_case   ON tickets(case_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_owner  ON tickets(owner);

-- ACTIVIDADES
CREATE TABLE IF NOT EXISTS activities (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ticket_id   INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  actor       TEXT,
  message     TEXT,
  metadata    TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_case ON activities(case_id, occurred_at);

-- COMENTARIOS
CREATE TABLE IF NOT EXISTS comments (
  id         SERIAL PRIMARY KEY,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  author     TEXT,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_case ON comments(case_id, created_at);

-- ARCHIVOS
CREATE TABLE IF NOT EXISTS files (
  id         SERIAL PRIMARY KEY,
  case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  mimetype   TEXT,
  size       INTEGER,
  data       BYTEA,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_case ON files(case_id);

-- VISTA DE MÉTRICAS
CREATE OR REPLACE VIEW case_metrics AS
SELECT
  c.id AS case_id,
  COUNT(t.id)::int AS total_children,
  COUNT(t.id) FILTER (WHERE t.status IN ('Asignada','Nueva','Abierta','Nuevo'))::int AS open_children,
  COUNT(t.id) FILTER (WHERE t.status = 'En Progreso')::int AS inprogress_children,
  COUNT(t.id) FILTER (WHERE t.status IN ('Pendiente','Verificar resolución'))::int AS pending_children,
  COUNT(t.id) FILTER (WHERE t.status IN ('Cerrada','Cerrado','Resuelta','Resuelto'))::int AS closed_children,
  COUNT(t.id) FILTER (WHERE t.is_critical = true)::int AS critical_children,
  MIN(t.created_at) AS first_child_at,
  MAX(COALESCE(t.updated_at, t.created_at)) AS last_child_activity_at
FROM cases c
LEFT JOIN tickets t ON t.case_id = c.id
GROUP BY c.id;
