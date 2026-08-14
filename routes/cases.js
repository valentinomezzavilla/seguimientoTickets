const express = require('express');
const db = require('../db');
const router = express.Router();

function getConfigList(kind, parent) {
  if (parent) return db.prepare("SELECT value FROM config_items WHERE kind=? AND parent=? ORDER BY sort_order, value").all(kind, parent).map(r => r.value);
  return db.prepare("SELECT value FROM config_items WHERE kind=? ORDER BY sort_order, value").all(kind).map(r => r.value);
}

router.get('/', (req, res) => {
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
  const params = {};

  if (f.q) {
    conds.push(`(
      CAST(c.id AS TEXT) LIKE @q OR c.subject LIKE @q OR c.owner LIKE @q OR c.module LIKE @q
      OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND (
        CAST(t.id AS TEXT) LIKE @q OR t.subject LIKE @q OR t.owner LIKE @q OR t.author LIKE @q
        OR t.procedure_nums LIKE @q OR t.suac_code LIKE @q OR t.cuil LIKE @q OR t.module LIKE @q
      ))
    )`);
    params.q = `%${f.q}%`;
  }
  if (f.status)   { conds.push(`c.general_status = @status`); params.status = f.status; }
  if (f.priority) { conds.push(`(c.priority = @priority OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.priority=@priority))`); params.priority = f.priority; }
  if (f.owner)    { conds.push(`(c.owner LIKE @owner OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND (t.owner LIKE @owner OR t.author LIKE @owner)))`); params.owner = `%${f.owner}%`; }
  if (f.module)   { conds.push(`(c.module LIKE @module OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.module LIKE @module))`); params.module = `%${f.module}%`; }
  if (f.tramite)  { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.procedure_name LIKE @tramite)`); params.tramite = `%${f.tramite}%`; }
  if (f.paso)     { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.step LIKE @paso)`); params.paso = `%${f.paso}%`; }
  if (f.seccion)  { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.section LIKE @seccion)`); params.seccion = `%${f.seccion}%`; }
  if (f.child_status) { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.status=@childStatus)`); params.childStatus = f.child_status; }
  if (f.child_type)   { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.ticket_type=@childType)`); params.childType = f.child_type; }
  if (f.canal)    { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.contact_channel LIKE @canal)`); params.canal = `%${f.canal}%`; }
  if (f.oficina)  { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.office LIKE @oficina)`); params.oficina = `%${f.oficina}%`; }
  if (f.ambiente) { conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.environment=@ambiente)`); params.ambiente = f.ambiente; }
  if (f.case_type){ conds.push(`c.case_type = @caseType`); params.caseType = f.case_type; }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM cases c JOIN case_metrics m ON m.case_id=c.id ${where}`).get(params).n;
  const cases = db.prepare(`
    SELECT c.*, m.total_children, m.open_children, m.inprogress_children,
           m.pending_children, m.closed_children, m.critical_children, m.last_child_activity_at
    FROM cases c JOIN case_metrics m ON m.case_id=c.id
    ${where}
    ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `).all(params);

  const distinctStatuses     = db.prepare(`SELECT DISTINCT general_status AS v FROM cases WHERE general_status IS NOT NULL ORDER BY 1`).all().map(r=>r.v);
  const distinctPriorities   = db.prepare(`SELECT DISTINCT priority AS v FROM cases WHERE priority IS NOT NULL ORDER BY 1`).all().map(r=>r.v);
  const distinctChildStatuses= db.prepare(`SELECT DISTINCT status AS v FROM tickets WHERE status IS NOT NULL ORDER BY 1`).all().map(r=>r.v);
  const distinctChildTypes   = db.prepare(`SELECT DISTINCT ticket_type AS v FROM tickets WHERE ticket_type IS NOT NULL ORDER BY 1`).all().map(r=>r.v);

  const cfgTramites   = getConfigList('tramite');
  const cfgOficinas   = getConfigList('oficina');
  const cfgOperadores = getConfigList('operador');
  const cfgAutores    = getConfigList('autor');

  res.render('cases/list', {
    title: 'Tickets',
    filters: f, cases, total, page, pageSize,
    pages: Math.ceil(total / pageSize),
    distinctStatuses, distinctPriorities, distinctChildStatuses, distinctChildTypes,
    cfgTramites, cfgOficinas, cfgOperadores, cfgAutores,
  });
});

// ---------- CREAR CASO NUEVO (ID manual) ----------
router.post('/nuevo', (req, res) => {
  const idStr = (req.body.id || '').trim();
  const id = parseInt(idStr, 10);
  const subject = (req.body.subject || '').trim();
  const priority = (req.body.priority || 'Media').trim();
  const owner = (req.body.owner || '').trim() || null;
  const author = (req.body.author || '').trim() || null;
  const module_ = (req.body.module || '').trim() || null;
  const system = (req.body.system || '').trim() || null;
  if (!subject || !Number.isFinite(id)) return res.redirect('/casos');

  const exists = db.prepare('SELECT id FROM cases WHERE id=?').get(id);
  if (exists) return res.redirect('/casos?err=id_duplicado');

  db.prepare(`
    INSERT INTO cases (id, subject, general_status, status_mode, priority, owner, author, module, system, case_type, created_at, last_activity_at)
    VALUES (?, ?, 'Nuevo', 'auto', ?, ?, ?, ?, ?, 'grouped', datetime('now'), datetime('now'))
  `).run(id, subject, priority, owner, author, module_, system);

  const actor = res.locals.currentUser?.fullname || author || 'sistema';
  db.prepare(`INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES (?, 'case_created', ?, ?, datetime('now'))`)
    .run(id, actor, `Caso creado: ${subject.slice(0,120)}`);

  res.redirect(`/casos/${id}`);
});

// ---------- DETALLE ----------
router.get('/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return next();
  const caseRow = db.prepare(`SELECT * FROM cases WHERE id=?`).get(id);
  if (!caseRow) return res.status(404).render('error', { title: 'No encontrado', message: `Caso #${id} no existe`, stack: '', filters: {} });

  const metrics = db.prepare(`SELECT * FROM case_metrics WHERE case_id=?`).get(id) || {};
  const children = db.prepare(`SELECT * FROM tickets WHERE case_id=? ORDER BY COALESCE(created_at,'') ASC, id ASC`).all(id);
  const activities = db.prepare(`
    SELECT a.*, t.subject AS ticket_subject
    FROM activities a LEFT JOIN tickets t ON t.id=a.ticket_id
    WHERE a.case_id=? ORDER BY COALESCE(a.occurred_at,'') DESC, a.id DESC
  `).all(id);
  const comments = db.prepare(`SELECT * FROM comments WHERE case_id=? ORDER BY created_at DESC`).all(id);
  const owners = db.prepare(`SELECT DISTINCT owner FROM tickets WHERE case_id=? AND owner IS NOT NULL ORDER BY owner`).all(id).map(r=>r.owner);
  const modules = db.prepare(`SELECT DISTINCT module FROM tickets WHERE case_id=? AND module IS NOT NULL ORDER BY module`).all(id).map(r=>r.module);

  const total = metrics.total_children || 0;
  const closed = metrics.closed_children || 0;
  const pctResolved = total ? Math.round((closed / total) * 100) : 0;

  const cfgTramites   = getConfigList('tramite');
  const cfgOficinas   = getConfigList('oficina');
  const cfgOperadores = getConfigList('operador');
  const cfgAutores    = getConfigList('autor');

  res.render('cases/detail', {
    title: `#${caseRow.id} — ${caseRow.subject}`,
    filters: {},
    caseRow, metrics, children, activities, comments, owners, modules, pctResolved,
    cfgTramites, cfgOficinas, cfgOperadores, cfgAutores,
  });
});

// ---------- POST acciones ----------
router.post('/:id/comments', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = (req.body.body || '').trim();
  const author = res.locals.currentUser?.fullname || 'anónimo';
  if (!body) return res.redirect(`/casos/${id}`);
  db.prepare(`INSERT INTO comments (case_id, body, author) VALUES (?,?,?)`).run(id, body, author);
  db.prepare(`INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES (?, 'comment', ?, ?, datetime('now'))`).run(id, author, body.slice(0,200));
  db.prepare(`UPDATE cases SET last_activity_at=datetime('now') WHERE id=?`).run(id);
  res.redirect(`/casos/${id}#actividad`);
});

router.post('/:id/status', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = (req.body.status || '').trim();
  const actor = res.locals.currentUser?.fullname || 'sistema';
  if (!status) return res.redirect(`/casos/${id}`);
  const prev = db.prepare(`SELECT general_status FROM cases WHERE id=?`).get(id);
  db.prepare(`UPDATE cases SET general_status=?, status_mode='manual', last_activity_at=datetime('now') WHERE id=?`).run(status, id);
  db.prepare(`INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES (?, 'status_change', ?, ?, datetime('now'))`)
    .run(id, actor, `${prev?.general_status||'?'} → ${status}`);
  res.redirect(`/casos/${id}`);
});

router.post('/:id/associate', (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const ticketId = parseInt(req.body.ticket_id, 10);
  if (!Number.isFinite(ticketId)) return res.redirect(`/casos/${caseId}`);
  const existing = db.prepare(`SELECT id FROM tickets WHERE id=?`).get(ticketId);
  if (!existing) return res.redirect(`/casos/${caseId}`);
  db.prepare(`UPDATE tickets SET case_id=? WHERE id=?`).run(caseId, ticketId);
  db.prepare(`INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES (?,?,'child_associated',?,?,datetime('now'))`)
    .run(caseId, ticketId, res.locals.currentUser?.fullname || 'usuario', `Ticket #${ticketId} asociado`);
  res.redirect(`/casos/${caseId}`);
});

router.post('/:id/dissociate', (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const ticketId = parseInt(req.body.ticket_id, 10);
  if (!Number.isFinite(ticketId)) return res.redirect(`/casos/${caseId}`);
  const t = db.prepare(`SELECT * FROM tickets WHERE id=?`).get(ticketId);
  if (!t) return res.redirect(`/casos/${caseId}`);
  db.prepare(`INSERT OR REPLACE INTO cases (id,subject,general_status,case_type,priority,owner,author,module,created_at) VALUES (?,'Nuevo','individual',?,?,?,?,?)`)
    .run(t.id, t.subject, t.priority, t.owner, t.author, t.module, t.created_at);
  db.prepare(`UPDATE tickets SET case_id=? WHERE id=?`).run(t.id, t.id);
  res.redirect(`/casos/${caseId}`);
});

router.post('/:id/children', (req, res) => {
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

  const exists = db.prepare('SELECT id FROM tickets WHERE id=?').get(id);
  if (exists) return res.redirect(`/casos/${caseId}?err=id_duplicado`);

  db.prepare(`
    INSERT INTO tickets (id, case_id, subject, priority, owner, author, ticket_type, status, procedure_name, step, office, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Asignada', ?, ?, ?, datetime('now'))
  `).run(id, caseId, subject, priority, owner, author, ticket_type, tramite, paso, oficina);

  const actor = res.locals.currentUser?.fullname || author || 'sistema';
  db.prepare(`INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES (?,?,'child_created',?,?,datetime('now'))`)
    .run(caseId, id, actor, subject);
  db.prepare(`UPDATE cases SET last_activity_at=datetime('now') WHERE id=?`).run(caseId);
  res.redirect(`/casos/${caseId}`);
});

module.exports = router;
