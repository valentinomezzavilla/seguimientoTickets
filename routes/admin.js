const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(requireAdmin);

// ---------- PANEL PRINCIPAL ----------
router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, fullname, role, active, created_at FROM users ORDER BY id').all();

  const kinds = ['tramite', 'paso', 'oficina', 'operador', 'autor'];
  const config = {};
  for (const k of kinds) {
    config[k] = db.prepare('SELECT * FROM config_items WHERE kind=? ORDER BY parent, sort_order, value').all(k);
  }

  const tramites = db.prepare("SELECT DISTINCT value FROM config_items WHERE kind='tramite' ORDER BY value").all().map(r => r.value);

  res.render('admin/index', {
    title: 'Configuraciones',
    filters: {},
    users, config, tramites,
  });
});

// ---------- USUARIOS ----------
router.post('/users', (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = (req.body.password || '').trim();
  const fullname = (req.body.fullname || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'operador';
  if (!username || !password) return res.redirect('/admin?err=campos');
  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (exists) return res.redirect('/admin?err=existe');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password, fullname, role) VALUES (?,?,?,?)').run(username, hash, fullname, role);
  res.redirect('/admin#usuarios');
});

router.post('/users/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.session.user.id) return res.redirect('/admin#usuarios');
  const u = db.prepare('SELECT active FROM users WHERE id=?').get(id);
  if (u) db.prepare('UPDATE users SET active=? WHERE id=?').run(u.active ? 0 : 1, id);
  res.redirect('/admin#usuarios');
});

router.post('/users/:id/reset-password', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const password = (req.body.password || '').trim();
  if (!password) return res.redirect('/admin#usuarios');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, id);
  res.redirect('/admin#usuarios');
});

// ---------- CONFIG ITEMS (bulk por kind) ----------
router.post('/config/:kind', (req, res) => {
  const kind = req.params.kind;
  const allowed = ['tramite', 'paso', 'oficina', 'operador', 'autor'];
  if (!allowed.includes(kind)) return res.redirect('/admin');

  const parent = (req.body.parent || '').trim() || null;
  const text = (req.body.items || '').trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const del = parent
    ? db.prepare('DELETE FROM config_items WHERE kind=? AND parent=?')
    : db.prepare('DELETE FROM config_items WHERE kind=? AND parent IS NULL');
  if (parent) del.run(kind, parent); else del.run(kind);

  const ins = db.prepare('INSERT INTO config_items (kind, parent, value, sort_order) VALUES (?,?,?,?)');
  const insertAll = db.transaction(() => {
    lines.forEach((line, i) => ins.run(kind, parent, line, i));
  });
  insertAll();

  res.redirect(`/admin#${kind}s`);
});

// ---------- API: obtener pasos por trámite ----------
router.get('/api/pasos', (req, res) => {
  const tramite = (req.query.tramite || '').trim();
  if (!tramite) return res.json([]);
  const rows = db.prepare("SELECT value FROM config_items WHERE kind='paso' AND parent=? ORDER BY sort_order, value").all(tramite);
  res.json(rows.map(r => r.value));
});

module.exports = router;
