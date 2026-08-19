const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
  // Sin esto, una base caida o pausada deja el arranque colgado para siempre y
  // el deploy de Render nunca pasa a "Live" (espera a que se abra el puerto).
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

// Cronometra cada paso del arranque para que los logs de Render muestren donde
// se va el tiempo en vez de quedar mudos hasta el "Escuchando en...".
async function step(label, fn) {
  const t0 = Date.now();
  const result = await fn();
  console.log(`[init] ${label}: ${Date.now() - t0}ms`);
  return result;
}

async function init() {
  const bootStart = Date.now();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  await step('conexion a la base', async () => {
    const c = await pool.connect();
    c.release();
  });

  await step('schema.sql', () => pool.query(schema));

  // Migrations: se agrupan en una sola ida y vuelta a la base en vez de seis.
  await step('migraciones de columnas', () => pool.query(`
    ALTER TABLE files ADD COLUMN IF NOT EXISTS mimetype TEXT;
    ALTER TABLE files ADD COLUMN IF NOT EXISTS size INTEGER;
    ALTER TABLE files ADD COLUMN IF NOT EXISTS data BYTEA;
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS procedure_name TEXT;
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS step TEXT;
    ALTER TABLE cases ADD COLUMN IF NOT EXISTS office TEXT;
  `));

  // Los tickets padre pasan a admitir varios tramites: se migra el valor unico
  // que vivia en cases.procedure_name a la tabla case_procedures.
  await step('backfill de tramites', () => pool.query(`
    INSERT INTO case_procedures (case_id, value, sort_order)
    SELECT c.id, TRIM(c.procedure_name), 0
    FROM cases c
    WHERE c.procedure_name IS NOT NULL AND TRIM(c.procedure_name) <> ''
      AND NOT EXISTS (SELECT 1 FROM case_procedures cp WHERE cp.case_id = c.id)
    ON CONFLICT (case_id, value) DO NOTHING
  `));

  await step('usuario admin', async () => {
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
    if (parseInt(rows[0].n, 10) === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await pool.query(
        `INSERT INTO users (username, password, fullname, role) VALUES ('admin', $1, 'Administrador', 'admin')`,
        [hash]
      );
    }
  });

  console.log(`[init] TOTAL: ${Date.now() - bootStart}ms`);
}

module.exports = { pool, init };
