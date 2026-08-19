const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  // Migrations
  await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS mimetype TEXT`);
  await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS size INTEGER`);
  await pool.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS data BYTEA`);
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS procedure_name TEXT`);
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS step TEXT`);
  await pool.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS office TEXT`);

  // Los tickets padre pasan a admitir varios tramites: se migra el valor unico
  // que vivia en cases.procedure_name a la tabla case_procedures.
  await pool.query(`
    INSERT INTO case_procedures (case_id, value, sort_order)
    SELECT c.id, TRIM(c.procedure_name), 0
    FROM cases c
    WHERE c.procedure_name IS NOT NULL AND TRIM(c.procedure_name) <> ''
      AND NOT EXISTS (SELECT 1 FROM case_procedures cp WHERE cp.case_id = c.id)
    ON CONFLICT (case_id, value) DO NOTHING
  `);

  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
  if (parseInt(rows[0].n, 10) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      `INSERT INTO users (username, password, fullname, role) VALUES ('admin', $1, 'Administrador', 'admin')`,
      [hash]
    );
  }
}

module.exports = { pool, init };
