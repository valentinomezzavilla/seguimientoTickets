const express = require('express');
const { pool } = require('../db');
const router = express.Router();

async function getConfigList(kind, parent) {
  if (parent) {
    const { rows } = await pool.query("SELECT value FROM config_items WHERE kind=$1 AND parent=$2 ORDER BY sort_order, value", [kind, parent]);
    return rows.map(r => r.value);
  }
  const { rows } = await pool.query("SELECT value FROM config_items WHERE kind=$1 ORDER BY sort_order, value", [kind]);
  return rows.map(r => r.value);
}

router.get('/', async (req, res, next) => {
  try {
    const f = {
      q:            (req.query.q || '').trim(),
      status:       (req.query.status || '').trim(),
      priority:     (req.query.priority || '').trim(),
      owner:        (req.query.owner || '').trim(),
      module:       (req.query.module || '').trim(),
      tramite:      (req.query.tramite || '').trim(),
      paso:         (req.query.paso || '').trim(),
      seccion:      (req.query.seccion || '').trim(),
      child_status: (req.query.child_status || '').trim(),
      child_type:   (req.query.child_type || '').trim(),
      canal:        (req.query.canal || '').trim(),
      oficina:      (req.query.oficina || '').trim(),
      ambiente:     (req.query.ambiente || '').trim(),
      case_type:    (req.query.case_type || '').trim(),
    };
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = 50;

    const conds = [];
    const params = [];
    let idx = 1;

    if (f.q) {
      const p = idx++;
      conds.push(`(
        CAST(c.id AS TEXT) LIKE $${p} OR c.subject ILIKE $${p} OR c.owner ILIKE $${p} OR c.module ILIKE $${p}
        OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND (
          CAST(t.id AS TEXT) LIKE $${p} OR t.subject ILIKE $${p} OR t.owner ILIKE $${p} OR t.author ILIKE $${p}
          OR t.procedure_nums ILIKE $${p} OR t.suac_code ILIKE $${p} OR t.cuil ILIKE $${p} OR t.module ILIKE $${p}
        ))
      )`);
      params.push(`%${f.q}%`);
    }
    if (f.status) {
      conds.push(`c.general_status = $${idx++}`);
      params.push(f.status);
    }
    if (f.priority) {
      const p = idx++;
      conds.push(`(c.priority = $${p} OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.priority=$${p}))`);
      params.push(f.priority);
    }
    if (f.owner) {
      const p = idx++;
      conds.push(`(c.owner ILIKE $${p} OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND (t.owner ILIKE $${p} OR t.author ILIKE $${p})))`);
      params.push(`%${f.owner}%`);
    }
    if (f.module) {
      const p = idx++;
      conds.push(`(c.module ILIKE $${p} OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.module ILIKE $${p}))`);
      params.push(`%${f.module}%`);
    }
    if (f.tramite) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.procedure_name ILIKE $${p})`);
      params.push(`%${f.tramite}%`);
    }
    if (f.paso) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.step ILIKE $${p})`);
      params.push(`%${f.paso}%`);
    }
    if (f.seccion) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.section ILIKE $${p})`);
      params.push(`%${f.seccion}%`);
    }
    if (f.child_status) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.status=$${p})`);
      params.push(f.child_status);
    }
    if (f.child_type) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.ticket_type=$${p})`);
      params.push(f.child_type);
    }
    if (f.canal) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.contact_channel ILIKE $${p})`);
      params.push(`%${f.canal}%`);
    }
    if (f.oficina) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.office ILIKE $${p})`);
      params.push(`%${f.oficina}%`);
    }
    if (f.ambiente) {
      const p = idx++;
      conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.environment=$${p})`);
      params.push(f.ambiente);
    }
    if (f.case_type) {
      const p = idx++;
      conds.push(`c.case_type = $${p}`);
      params.push(f.case_type);
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const countRes = await pool.query(`SELECT COUNT(*) AS n FROM cases c JOIN case_metrics m ON m.case_id=c.id ${where}`, params);
    const total = parseInt(countRes.rows[0].n, 10);

    const offset = (page - 1) * pageSize;
    const casesRes = await pool.query(`
      SELECT c.*, m.total_children, m.open_children, m.inprogress_children,
             m.pending_children, m.closed_children, m.critical_children, m.last_child_activity_at
      FROM cases c JOIN case_metrics m ON m.case_id=c.id
      ${where}
      ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, pageSize, offset]);

    const [statusRes, priorityRes, childStatusRes, childTypeRes] = await Promise.all([
      pool.query(`SELECT DISTINCT general_status AS v FROM cases WHERE general_status IS NOT NULL ORDER BY 1`),
      pool.query(`SELECT DISTINCT priority AS v FROM cases WHERE priority IS NOT NULL ORDER BY 1`),
      pool.query(`SELECT DISTINCT status AS v FROM tickets WHERE status IS NOT NULL ORDER BY 1`),
      pool.query(`SELECT DISTINCT ticket_type AS v FROM tickets WHERE ticket_type IS NOT NULL ORDER BY 1`),
    ]);

    const [cfgTramites, cfgOficinas, cfgOperadores, cfgAutores] = await Promise.all([
      getConfigList('tramite'),
      getConfigList('oficina'),
      getConfigList('operador'),
      getConfigList('autor'),
    ]);

    res.render('cases/list', {
      title: 'Tickets',
      filters: f,
      cases: casesRes.rows,
      total, page, pageSize,
      pages: Math.ceil(total / pageSize),
      distinctStatuses: statusRes.rows.map(r => r.v),
      distinctPriorities: priorityRes.rows.map(r => r.v),
      distinctChildStatuses: childStatusRes.rows.map(r => r.v),
      distinctChildTypes: childTypeRes.rows.map(r => r.v),
      cfgTramites, cfgOficinas, cfgOperadores, cfgAutores,
    });
  } catch (err) { next(err); }
});

router.post('/nuevo', async (req, res, next) => {
  try {
    const idStr = (req.body.id || '').trim();
    const id = parseInt(idStr, 10);
    const subject = (req.body.subject || '').trim();
    const priority = (req.body.priority || 'Media').trim();
    const owner = (req.body.owner || '').trim() || null;
    const author = (req.body.author || '').trim() || null;
    const module_ = (req.body.module || '').trim() || null;
    const system = (req.body.system || '').trim() || null;
    if (!subject || !Number.isFinite(id)) return res.redirect('/casos');

    const exists = await pool.query('SELECT id FROM cases WHERE id=$1', [id]);
    if (exists.rows.length) return res.redirect('/casos?err=id_duplicado');

    await pool.query(`
      INSERT INTO cases (id, subject, general_status, status_mode, priority, owner, author, module, system, case_type, created_at, last_activity_at)
      VALUES ($1, $2, 'Nuevo', 'auto', $3, $4, $5, $6, $7, 'grouped', NOW(), NOW())
    `, [id, subject, priority, owner, author, module_, system]);

    const actor = res.locals.currentUser?.fullname || author || 'sistema';
    await pool.query(
      `INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1, 'case_created', $2, $3, NOW())`,
      [id, actor, `Caso creado: ${subject.slice(0,120)}`]
    );

    res.redirect(`/casos/${id}`);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return next();
    const caseRes = await pool.query('SELECT * FROM cases WHERE id=$1', [id]);
    const caseRow = caseRes.rows[0];
    if (!caseRow) return res.status(404).render('error', { title: 'No encontrado', message: `Caso #${id} no existe`, stack: '', filters: {} });

    const [metricsRes, childrenRes, activitiesRes, commentsRes, ownersRes, modulesRes] = await Promise.all([
      pool.query('SELECT * FROM case_metrics WHERE case_id=$1', [id]),
      pool.query('SELECT * FROM tickets WHERE case_id=$1 ORDER BY COALESCE(created_at, \'1970-01-01\') ASC, id ASC', [id]),
      pool.query(`
        SELECT a.*, t.subject AS ticket_subject
        FROM activities a LEFT JOIN tickets t ON t.id=a.ticket_id
        WHERE a.case_id=$1 ORDER BY COALESCE(a.occurred_at, '1970-01-01') DESC, a.id DESC
      `, [id]),
      pool.query('SELECT * FROM comments WHERE case_id=$1 ORDER BY created_at DESC', [id]),
      pool.query('SELECT DISTINCT owner FROM tickets WHERE case_id=$1 AND owner IS NOT NULL ORDER BY owner', [id]),
      pool.query('SELECT DISTINCT module FROM tickets WHERE case_id=$1 AND module IS NOT NULL ORDER BY module', [id]),
    ]);

    const metrics = metricsRes.rows[0] || {};
    const total = metrics.total_children || 0;
    const closed = metrics.closed_children || 0;
    const pctResolved = total ? Math.round((closed / total) * 100) : 0;

    const [cfgTramites, cfgOficinas, cfgOperadores, cfgAutores] = await Promise.all([
      getConfigList('tramite'),
      getConfigList('oficina'),
      getConfigList('operador'),
      getConfigList('autor'),
    ]);

    res.render('cases/detail', {
      title: `#${caseRow.id} — ${caseRow.subject}`,
      filters: {},
      caseRow, metrics,
      children: childrenRes.rows,
      activities: activitiesRes.rows,
      comments: commentsRes.rows,
      owners: ownersRes.rows.map(r => r.owner),
      modules: modulesRes.rows.map(r => r.module),
      pctResolved,
      cfgTramites, cfgOficinas, cfgOperadores, cfgAutores,
    });
  } catch (err) { next(err); }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = (req.body.body || '').trim();
    const author = res.locals.currentUser?.fullname || 'anónimo';
    if (!body) return res.redirect(`/casos/${id}`);
    await pool.query('INSERT INTO comments (case_id, body, author) VALUES ($1,$2,$3)', [id, body, author]);
    await pool.query(`INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1, 'comment', $2, $3, NOW())`, [id, author, body.slice(0,200)]);
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [id]);
    res.redirect(`/casos/${id}#actividad`);
  } catch (err) { next(err); }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = (req.body.status || '').trim();
    const actor = res.locals.currentUser?.fullname || 'sistema';
    if (!status) return res.redirect(`/casos/${id}`);
    const prev = await pool.query('SELECT general_status FROM cases WHERE id=$1', [id]);
    await pool.query("UPDATE cases SET general_status=$1, status_mode='manual', last_activity_at=NOW() WHERE id=$2", [status, id]);
    await pool.query(
      `INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1, 'status_change', $2, $3, NOW())`,
      [id, actor, `${prev.rows[0]?.general_status||'?'} → ${status}`]
    );
    res.redirect(`/casos/${id}`);
  } catch (err) { next(err); }
});

router.post('/:id/associate', async (req, res, next) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    const ticketId = parseInt(req.body.ticket_id, 10);
    if (!Number.isFinite(ticketId)) return res.redirect(`/casos/${caseId}`);
    const existing = await pool.query('SELECT id FROM tickets WHERE id=$1', [ticketId]);
    if (!existing.rows.length) return res.redirect(`/casos/${caseId}`);
    await pool.query('UPDATE tickets SET case_id=$1 WHERE id=$2', [caseId, ticketId]);
    await pool.query(
      `INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES ($1,$2,'child_associated',$3,$4,NOW())`,
      [caseId, ticketId, res.locals.currentUser?.fullname || 'usuario', `Ticket #${ticketId} asociado`]
    );
    res.redirect(`/casos/${caseId}`);
  } catch (err) { next(err); }
});

router.post('/:id/dissociate', async (req, res, next) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    const ticketId = parseInt(req.body.ticket_id, 10);
    if (!Number.isFinite(ticketId)) return res.redirect(`/casos/${caseId}`);
    const tRes = await pool.query('SELECT * FROM tickets WHERE id=$1', [ticketId]);
    const t = tRes.rows[0];
    if (!t) return res.redirect(`/casos/${caseId}`);

    await pool.query(
      `INSERT INTO cases (id,subject,general_status,case_type,priority,owner,author,module,created_at)
       VALUES ($1,$2,'Nuevo','individual',$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET subject=$2, general_status='Nuevo', case_type='individual'`,
      [t.id, t.subject, t.priority, t.owner, t.author, t.module, t.created_at]
    );
    await pool.query('UPDATE tickets SET case_id=$1 WHERE id=$2', [t.id, t.id]);
    res.redirect(`/casos/${caseId}`);
  } catch (err) { next(err); }
});

router.post('/:id/children', async (req, res, next) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    const idStr = (req.body.id || '').trim();
    const id = parseInt(idStr, 10);
    const subject = (req.body.subject || '').trim();
    const priority = (req.body.priority || 'Media').trim();
    const owner = (req.body.owner || '').trim() || null;
    const author = (req.body.author || '').trim() || null;
    const ticket_type = (req.body.ticket_type || 'Incidente Mi RC').trim();
    const tramite = (req.body.tramite || '').trim() || null;
    const paso = (req.body.paso || '').trim() || null;
    const oficina = (req.body.oficina || '').trim() || null;
    if (!subject || !Number.isFinite(id)) return res.redirect(`/casos/${caseId}`);

    const exists = await pool.query('SELECT id FROM tickets WHERE id=$1', [id]);
    if (exists.rows.length) return res.redirect(`/casos/${caseId}?err=id_duplicado`);

    await pool.query(`
      INSERT INTO tickets (id, case_id, subject, priority, owner, author, ticket_type, status, procedure_name, step, office, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Asignada', $8, $9, $10, NOW())
    `, [id, caseId, subject, priority, owner, author, ticket_type, tramite, paso, oficina]);

    const actor = res.locals.currentUser?.fullname || author || 'sistema';
    await pool.query(
      `INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES ($1,$2,'child_created',$3,$4,NOW())`,
      [caseId, id, actor, subject]
    );
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [caseId]);
    res.redirect(`/casos/${caseId}`);
  } catch (err) { next(err); }
});

module.exports = router;
