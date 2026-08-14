const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const usersRes = await pool.query('SELECT id, username, fullname, role, active, created_at FROM users ORDER BY id');

    const kinds = ['tramite', 'paso', 'modulo', 'oficina', 'operador', 'autor'];
    const config = {};
    for (const k of kinds) {
      const r = await pool.query('SELECT * FROM config_items WHERE kind=$1 ORDER BY parent, sort_order, value', [k]);
      config[k] = r.rows;
    }

    res.render('admin/index', {
      title: 'Configuraciones',
      filters: {},
      users: usersRes.rows,
      config,
    });
  } catch (err) { next(err); }
});

router.post('/users', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();
    const fullname = (req.body.fullname || '').trim();
    const role = req.body.role === 'admin' ? 'admin' : 'operador';
    if (!username || !password) return res.redirect('/admin?err=campos');
    const exists = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
    if (exists.rows.length) return res.redirect('/admin?err=existe');
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('INSERT INTO users (username, password, fullname, role) VALUES ($1,$2,$3,$4)', [username, hash, fullname, role]);
    res.redirect('/admin#usuarios');
  } catch (err) { next(err); }
});

router.post('/users/:id/toggle', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.session.user.id) return res.redirect('/admin#usuarios');
    const u = await pool.query('SELECT active FROM users WHERE id=$1', [id]);
    if (u.rows.length) {
      await pool.query('UPDATE users SET active=$1 WHERE id=$2', [!u.rows[0].active, id]);
    }
    res.redirect('/admin#usuarios');
  } catch (err) { next(err); }
});

router.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const password = (req.body.password || '').trim();
    if (!password) return res.redirect('/admin#usuarios');
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, id]);
    res.redirect('/admin#usuarios');
  } catch (err) { next(err); }
});

router.post('/config/:kind', async (req, res, next) => {
  try {
    const kind = req.params.kind;
    const allowed = ['tramite', 'paso', 'modulo', 'oficina', 'operador', 'autor'];
    if (!allowed.includes(kind)) return res.redirect('/admin');

    const parent = (req.body.parent || '').trim() || null;
    const text = (req.body.items || '').trim();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (parent) {
        await client.query('DELETE FROM config_items WHERE kind=$1 AND parent=$2', [kind, parent]);
      } else {
        await client.query('DELETE FROM config_items WHERE kind=$1 AND parent IS NULL', [kind]);
      }
      for (let i = 0; i < lines.length; i++) {
        await client.query('INSERT INTO config_items (kind, parent, value, sort_order) VALUES ($1,$2,$3,$4)', [kind, parent, lines[i], i]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.redirect(`/admin#${kind}s`);
  } catch (err) { next(err); }
});

router.get('/api/pasos', async (req, res, next) => {
  try {
    const tramite = (req.query.tramite || '').trim();
    if (!tramite) return res.json([]);
    const { rows } = await pool.query("SELECT value FROM config_items WHERE kind='paso' AND parent=$1 ORDER BY sort_order, value", [tramite]);
    res.json(rows.map(r => r.value));
  } catch (err) { next(err); }
});

module.exports = router;
