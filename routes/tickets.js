const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return next();
  const t = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(id);
  if (!t) return res.status(404).render('error', { title: 'No encontrado', message: `Ticket #${id} no existe`, stack: '' });
  const caseRow = db.prepare(`SELECT * FROM cases WHERE id=?`).get(t.case_id);
  res.render('tickets/detail', { title: `Ticket #${t.id}`, active: 'cases', ticket: t, caseRow });
});

router.post('/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = (req.body.status || '').trim();
  const actor = (req.body.actor || 'sistema').trim();
  if (!status) return res.redirect(`/tickets/${id}`);
  const t = db.prepare(`SELECT case_id, status FROM tickets WHERE id=?`).get(id);
  if (!t) return res.redirect('/');
  db.prepare(`UPDATE tickets SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, id);
  db.prepare(`INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES (?, ?, 'status_change', ?, ?, datetime('now'))`)
    .run(t.case_id, id, actor, `${t.status || '?'} → ${status}`);
  db.prepare(`UPDATE cases SET last_activity_at=datetime('now') WHERE id=?`).run(t.case_id);
  res.redirect(`/casos/${t.case_id}#hijos`);
});

module.exports = router;
