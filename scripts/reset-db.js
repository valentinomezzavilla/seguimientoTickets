const { pool, init } = require('../db');

async function reset() {
  await pool.query('DROP VIEW IF EXISTS case_metrics CASCADE');
  await pool.query('DROP TABLE IF EXISTS files CASCADE');
  await pool.query('DROP TABLE IF EXISTS comments CASCADE');
  await pool.query('DROP TABLE IF EXISTS activities CASCADE');
  await pool.query('DROP TABLE IF EXISTS tickets CASCADE');
  await pool.query('DROP TABLE IF EXISTS cases CASCADE');
  await pool.query('DROP TABLE IF EXISTS config_items CASCADE');
  await pool.query('DROP TABLE IF EXISTS users CASCADE');
  console.log('Tablas eliminadas.');
  await init();
  console.log('DB reconstruida desde schema.');
  await pool.end();
}

reset().catch(err => { console.error(err); process.exit(1); });
