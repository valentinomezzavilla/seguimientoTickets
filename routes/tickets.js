const express = require('express');
const { pool } = require('../db');
const router = express.Router();

async function getConfigList(kind) {
  const { rows } = await pool.query("SELECT value FROM config_items WHERE kind=$1 ORDER BY sort_order, value", [kind]);
  return rows.map(r => r.value);
}

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return next();
    const tRes = await pool.query('SELECT * FROM tickets WHERE id=$1', [id]);
    const t = tRes.rows[0];
    if (!t) return res.status(404).render('error', { title: 'No encontrado', message: `Ticket #${id} no existe`, stack: '' });
    const [caseRes, filesRes, cfgTramites, cfgPasos, cfgOficinas, cfgOperadores, cfgAutores, cfgModulos] = await Promise.all([
      pool.query('SELECT * FROM cases WHERE id=$1', [t.case_id]),
      pool.query('SELECT id, name, mimetype, size, uploaded_by, created_at FROM files WHERE ticket_id=$1 ORDER BY created_at DESC', [id]),
      getConfigList('tramite'),
      getConfigList('paso'),
      getConfigList('oficina'),
      getConfigList('operador'),
      getConfigList('autor'),
      getConfigList('modulo'),
    ]);
    res.render('tickets/detail', {
      title: `Ticket #${t.id}`, active: 'cases', ticket: t, caseRow: caseRes.rows[0], files: filesRes.rows,
      cfgTramites, cfgPasos, cfgOficinas, cfgOperadores, cfgAutores, cfgModulos,
    });
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

// Marcar como resuelto: un solo click, sin pasar por el selector de estados.
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const tRes = await pool.query('SELECT case_id, status FROM tickets WHERE id=$1', [id]);
    const t = tRes.rows[0];
    if (!t) return res.redirect('/casos');

    const actor = res.locals.currentUser?.fullname || 'sistema';
    await pool.query(
      `UPDATE tickets SET status='Cerrada', finished_at=COALESCE(finished_at, NOW()),
              closed_at=COALESCE(closed_at, NOW()), updated_at=NOW() WHERE id=$1`,
      [id]
    );
    await pool.query(
      `INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES ($1,$2,'status_change',$3,$4,NOW())`,
      [t.case_id, id, actor, `${t.status || '?'} → Cerrada`]
    );
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [t.case_id]);
    res.redirect(req.body.back || `/casos/${t.case_id}#hijos`);
  } catch (err) { next(err); }
});

// Reabrir, para poder deshacer un "resuelto" marcado por error.
router.post('/:id/reopen', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const tRes = await pool.query('SELECT case_id, status FROM tickets WHERE id=$1', [id]);
    const t = tRes.rows[0];
    if (!t) return res.redirect('/casos');

    const actor = res.locals.currentUser?.fullname || 'sistema';
    await pool.query(
      `UPDATE tickets SET status='Asignada', closed_at=NULL, finished_at=NULL, updated_at=NOW() WHERE id=$1`,
      [id]
    );
    await pool.query(
      `INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES ($1,$2,'status_change',$3,$4,NOW())`,
      [t.case_id, id, actor, `${t.status || '?'} → Asignada (reabierto)`]
    );
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [t.case_id]);
    res.redirect(req.body.back || `/casos/${t.case_id}#hijos`);
  } catch (err) { next(err); }
});

// Editar los campos que se cargan a mano al crear el hijo.
router.post('/:id/edit', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const tRes = await pool.query('SELECT case_id FROM tickets WHERE id=$1', [id]);
    const t = tRes.rows[0];
    if (!t) return res.redirect('/casos');

    const subject = (req.body.subject || '').trim();
    if (!subject) return res.redirect(`/tickets/${id}?err=asunto_vacio`);

    const nz = (v) => { const x = (v || '').trim(); return x || null; };
    await pool.query(`
      UPDATE tickets SET subject=$1, description=$2, priority=$3, owner=$4, author=$5,
             ticket_type=$6, procedure_name=$7, step=$8, office=$9, module=$10, updated_at=NOW()
      WHERE id=$11
    `, [
      subject, nz(req.body.description), nz(req.body.priority), nz(req.body.owner),
      nz(req.body.author), nz(req.body.ticket_type), nz(req.body.tramite),
      nz(req.body.paso), nz(req.body.oficina), nz(req.body.module), id,
    ]);

    const actor = res.locals.currentUser?.fullname || 'sistema';
    await pool.query(
      `INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES ($1,$2,'ticket_edited',$3,$4,NOW())`,
      [t.case_id, id, actor, `Ticket editado: ${subject.slice(0, 120)}`]
    );
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [t.case_id]);
    res.redirect(req.body.back || `/tickets/${id}`);
  } catch (err) { next(err); }
});

// Eliminar. Las activities/comments/files quedan con ticket_id NULL por el
// ON DELETE SET NULL del schema, asi que el historial del caso no se pierde.
router.post('/:id/delete', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const tRes = await pool.query('SELECT case_id, subject FROM tickets WHERE id=$1', [id]);
    const t = tRes.rows[0];
    if (!t) return res.redirect('/casos');

    const actor = res.locals.currentUser?.fullname || 'sistema';
    await pool.query('DELETE FROM tickets WHERE id=$1', [id]);
    await pool.query(
      `INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1,'ticket_deleted',$2,$3,NOW())`,
      [t.case_id, actor, `Ticket #${id} eliminado: ${(t.subject || '').slice(0, 120)}`]
    );
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [t.case_id]);
    res.redirect(`/casos/${t.case_id}#hijos`);
  } catch (err) { next(err); }
});

module.exports = router;
