const express = require('express');
const { pool } = require('../db');
const router = express.Router();

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return next();
    const tRes = await pool.query('SELECT * FROM tickets WHERE id=$1', [id]);
    const t = tRes.rows[0];
    if (!t) return res.status(404).render('error', { title: 'No encontrado', message: `Ticket #${id} no existe`, stack: '' });
    const caseRes = await pool.query('SELECT * FROM cases WHERE id=$1', [t.case_id]);
    res.render('tickets/detail', { title: `Ticket #${t.id}`, active: 'cases', ticket: t, caseRow: caseRes.rows[0] });
  } catch (err) { next(err); }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = (req.body.status || '').trim();
    const actor = (req.body.actor || 'sistema').trim();
    if (!status) return res.redirect(`/tickets/${id}`);
    const tRes = await pool.query('SELECT case_id, status FROM tickets WHERE id=$1', [id]);
    const t = tRes.rows[0];
    if (!t) return res.redirect('/');
    await pool.query('UPDATE tickets SET status=$1, updated_at=NOW() WHERE id=$2', [status, id]);
    await pool.query(
      `INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES ($1, $2, 'status_change', $3, $4, NOW())`,
      [t.case_id, id, actor, `${t.status || '?'} → ${status}`]
    );
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [t.case_id]);
    res.redirect(`/casos/${t.case_id}#hijos`);
  } catch (err) { next(err); }
});

module.exports = router;
