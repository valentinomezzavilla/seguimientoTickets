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
