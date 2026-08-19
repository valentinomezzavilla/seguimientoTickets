const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function getConfigList(kind) {
  const { rows } = await pool.query("SELECT value FROM config_items WHERE kind=$1 ORDER BY sort_order, value", [kind]);
  return rows.map(r => r.value);
}

// Un ticket padre admite varios tramites. El formulario los manda como campos
// repetidos `tramite`, que express entrega como string o array segun la cantidad.
function parseTramites(raw) {
  const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
  const out = [];
  for (const item of list) {
    const v = String(item || '').trim();
    if (v && !out.some(x => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

// Reemplaza los tramites del caso y mantiene cases.procedure_name como resumen
// legible para las vistas y datos historicos.
async function setCaseProcedures(caseId, tramites) {
  await pool.query('DELETE FROM case_procedures WHERE case_id=$1', [caseId]);
  for (let i = 0; i < tramites.length; i++) {
    await pool.query(
      'INSERT INTO case_procedures (case_id, value, sort_order) VALUES ($1,$2,$3) ON CONFLICT (case_id, value) DO NOTHING',
      [caseId, tramites[i], i]
    );
  }
  await pool.query('UPDATE cases SET procedure_name=$1 WHERE id=$2', [tramites.join(' | ') || null, caseId]);
}

async function getCaseProcedures(caseId) {
  const { rows } = await pool.query(
    'SELECT value FROM case_procedures WHERE case_id=$1 ORDER BY sort_order, value',
    [caseId]
  );
  return rows.map(r => r.value);
}

async function getAllConfigs() {
  const [cfgTramites, cfgPasos, cfgModulos, cfgOficinas, cfgOperadores, cfgAutores] = await Promise.all([
    getConfigList('tramite'),
    getConfigList('paso'),
    getConfigList('modulo'),
    getConfigList('oficina'),
    getConfigList('operador'),
    getConfigList('autor'),
  ]);
  return { cfgTramites, cfgPasos, cfgModulos, cfgOficinas, cfgOperadores, cfgAutores };
}

// Lee los filtros del querystring. Compartido por el listado y el export para
// que el CSV salga siempre con el mismo recorte que se ve en pantalla.
function readFilters(query) {
  const f = {
      q:            (query.q || '').trim(),
      status:       (query.status || '').trim(),
      priority:     (query.priority || '').trim(),
      owner:        (query.owner || '').trim(),
      module:       (query.module || '').trim(),
      tramite:      (query.tramite || '').trim(),
      paso:         (query.paso || '').trim(),
      seccion:      (query.seccion || '').trim(),
      child_status: (query.child_status || '').trim(),
      child_type:   (query.child_type || '').trim(),
      canal:        (query.canal || '').trim(),
      oficina:      (query.oficina || '').trim(),
      ambiente:     (query.ambiente || '').trim(),
    case_type:    (query.case_type || '').trim(),
  };
  return f;
}

// Traduce los filtros a WHERE + params.
function buildWhere(f) {
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
    if (f.status)   { conds.push(`c.general_status = $${idx++}`); params.push(f.status); }
    if (f.priority) { const p = idx++; conds.push(`(c.priority = $${p} OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.priority=$${p}))`); params.push(f.priority); }
    if (f.owner)    { const p = idx++; conds.push(`(c.owner ILIKE $${p} OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND (t.owner ILIKE $${p} OR t.author ILIKE $${p})))`); params.push(`%${f.owner}%`); }
    if (f.module)   { const p = idx++; conds.push(`(c.module ILIKE $${p} OR EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.module ILIKE $${p}))`); params.push(`%${f.module}%`); }
    if (f.tramite)  {
      const p = idx++;
      conds.push(`(
        EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.procedure_name ILIKE $${p})
        OR EXISTS (SELECT 1 FROM case_procedures cp WHERE cp.case_id=c.id AND cp.value ILIKE $${p})
      )`);
      params.push(`%${f.tramite}%`);
    }
    if (f.paso)     { const p = idx++; conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.step ILIKE $${p})`); params.push(`%${f.paso}%`); }
    if (f.seccion)  { const p = idx++; conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.section ILIKE $${p})`); params.push(`%${f.seccion}%`); }
    if (f.child_status) { const p = idx++; conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.status=$${p})`); params.push(f.child_status); }
    if (f.child_type)   { const p = idx++; conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.ticket_type=$${p})`); params.push(f.child_type); }
    if (f.canal)    { const p = idx++; conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.contact_channel ILIKE $${p})`); params.push(`%${f.canal}%`); }
    if (f.oficina)  { const p = idx++; conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.office ILIKE $${p})`); params.push(`%${f.oficina}%`); }
    if (f.ambiente) { const p = idx++; conds.push(`EXISTS (SELECT 1 FROM tickets t WHERE t.case_id=c.id AND t.environment=$${p})`); params.push(f.ambiente); }
    if (f.case_type){ const p = idx++; conds.push(`c.case_type = $${p}`); params.push(f.case_type); }

  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params, nextIdx: idx };
}

router.get('/', async (req, res, next) => {
  try {
    const f = readFilters(req.query);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = 50;
    let { where, params, nextIdx: idx } = buildWhere(f);

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

    const cfg = await getAllConfigs();

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
      ...cfg,
    });
  } catch (err) { next(err); }
});

// ---------- EXPORT ----------
// Escapa un valor para CSV: comillas dobladas y celda entrecomillada si hace
// falta. El apostrofe inicial evita que Excel interprete como formula un valor
// que empiece con = + - @ (CSV injection).
function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(';');
}

function fmtCsvDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

router.get('/export', async (req, res, next) => {
  try {
    const f = readFilters(req.query);
    const { where, params } = buildWhere(f);
    const scope = req.query.scope === 'casos' ? 'casos' : 'incidentes';

    const casesRes = await pool.query(`
      SELECT c.*, m.total_children, m.open_children, m.inprogress_children,
             m.pending_children, m.closed_children, m.critical_children, m.last_child_activity_at,
             (SELECT string_agg(cp.value, ' | ' ORDER BY cp.sort_order, cp.value)
                FROM case_procedures cp WHERE cp.case_id = c.id) AS tramites
      FROM cases c JOIN case_metrics m ON m.case_id=c.id
      ${where}
      ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC
    `, params);
    const cases = casesRes.rows;

    // Los hijos salen de los casos ya filtrados, para que el detalle coincida
    // exactamente con el resumen.
    const ids = cases.map(c => c.id);
    let tickets = [];
    if (scope === 'incidentes' && ids.length) {
      const tRes = await pool.query(`
        SELECT t.*, c.subject AS case_subject, c.general_status AS case_status
        FROM tickets t JOIN cases c ON c.id = t.case_id
        WHERE t.case_id = ANY($1::int[])
        ORDER BY t.case_id, COALESCE(t.created_at, '1970-01-01') ASC, t.id ASC
      `, [ids]);
      tickets = tRes.rows;
    }

    const cerrado = (st) => ['Cerrada', 'Cerrado', 'Resuelta', 'Resuelto'].includes(st);
    const filas = scope === 'casos' ? cases : tickets;

    // ---- Resumen ----
    const porEstado = new Map();
    const porPrioridad = new Map();
    const porResponsable = new Map();
    const bump = (map, key) => {
      const k = key || '(sin asignar)';
      map.set(k, (map.get(k) || 0) + 1);
    };
    for (const r of filas) {
      bump(porEstado, scope === 'casos' ? r.general_status : r.status);
      bump(porPrioridad, r.priority);
      bump(porResponsable, r.owner);
    }
    const totalFilas = filas.length;
    const resueltos = filas.filter(r => cerrado(scope === 'casos' ? r.general_status : r.status)).length;
    const criticos = scope === 'casos'
      ? cases.reduce((n, c) => n + (c.critical_children || 0), 0)
      : tickets.filter(t => t.is_critical).length;

    const filtrosActivos = Object.entries(f).filter(([, v]) => v);
    const out = [];
    const sec = (t) => { out.push(''); out.push(csvRow([t])); };

    out.push(csvRow(['RESUMEN - Seguimiento de Tickets']));
    out.push(csvRow(['Generado', fmtCsvDate(new Date())]));
    out.push(csvRow(['Generado por', res.locals.currentUser?.fullname || '-']));
    out.push(csvRow(['Alcance', scope === 'casos' ? 'Tickets padre' : 'Incidentes (tickets hijos)']));
    out.push(csvRow(['Filtros aplicados', filtrosActivos.length
      ? filtrosActivos.map(([k, v]) => `${k}=${v}`).join(', ')
      : 'ninguno (todos los registros)']));
    out.push('');
    out.push(csvRow(['Tickets padre alcanzados', cases.length]));
    if (scope === 'incidentes') out.push(csvRow(['Incidentes alcanzados', tickets.length]));
    out.push(csvRow(['Resueltos / cerrados', resueltos]));
    out.push(csvRow(['Pendientes', totalFilas - resueltos]));
    out.push(csvRow(['% resuelto', totalFilas ? Math.round((resueltos / totalFilas) * 100) + '%' : '-']));
    out.push(csvRow(['Criticos', criticos]));

    const bloque = (titulo, map) => {
      sec(titulo);
      out.push(csvRow(['Valor', 'Cantidad', '% del total']));
      [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
        out.push(csvRow([k, n, totalFilas ? Math.round((n / totalFilas) * 100) + '%' : '0%']));
      });
    };
    bloque('POR ESTADO', porEstado);
    bloque('POR PRIORIDAD', porPrioridad);
    bloque('POR RESPONSABLE', porResponsable);

    // ---- Detalle ----
    if (scope === 'casos') {
      sec('DETALLE - TICKETS PADRE');
      out.push(csvRow(['#ID', 'Asunto', 'Estado', 'Prioridad', 'Responsable', 'Autor', 'Modulo',
        'Sistema', 'Tramites', 'Paso', 'Oficina', 'Hijos', 'Abiertos', 'En progreso', 'Pendientes',
        'Cerrados', 'Criticos', '% resuelto', 'Creado', 'Ultima actividad']));
      for (const c of cases) {
        const tot = c.total_children || 0;
        out.push(csvRow([c.id, c.subject, c.general_status, c.priority, c.owner, c.author, c.module,
          c.system, c.tramites || c.procedure_name, c.step, c.office, tot, c.open_children,
          c.inprogress_children, c.pending_children, c.closed_children, c.critical_children,
          tot ? Math.round(((c.closed_children || 0) / tot) * 100) + '%' : '-',
          fmtCsvDate(c.created_at), fmtCsvDate(c.last_child_activity_at || c.last_activity_at)]));
      }
    } else {
      sec('DETALLE - INCIDENTES');
      out.push(csvRow(['#ID', 'Caso padre', 'Asunto del caso', 'Estado del caso', 'Asunto', 'Estado',
        'Prioridad', 'Responsable', 'Autor', 'Tipo', 'Modulo', 'Sistema', 'Tramite', 'Paso',
        'Seccion', 'Oficina', 'Canal', 'Ambiente', 'Nro. de tramite', 'Codigo SUAC', 'CUIL',
        'Critico', 'Creado', 'Inicio', 'Fin', 'Cerrado', 'Actualizado']));
      for (const t of tickets) {
        out.push(csvRow([t.id, t.case_id, t.case_subject, t.case_status, t.subject, t.status,
          t.priority, t.owner, t.author, t.ticket_type, t.module, t.system || t.system_module,
          t.procedure_name, t.step, t.section, t.office, t.contact_channel, t.environment,
          t.procedure_nums, t.suac_code, t.cuil, t.is_critical ? 'Si' : 'No',
          fmtCsvDate(t.created_at), fmtCsvDate(t.started_at), fmtCsvDate(t.finished_at),
          fmtCsvDate(t.closed_at), fmtCsvDate(t.updated_at)]));
      }
    }

    // BOM + CRLF para que Excel abra los acentos y las filas correctamente.
    const csv = '﻿' + out.join('\r\n') + '\r\n';
    const hoy = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="seguimiento-${scope}-${hoy}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

router.post('/nuevo', async (req, res, next) => {
  try {
    const idStr = (req.body.id || '').trim();
    const id = parseInt(idStr, 10);
    const subject = (req.body.subject || '').trim();
    const description = (req.body.description || '').trim() || null;
    const priority = (req.body.priority || 'Media').trim();
    const owner = (req.body.owner || '').trim() || null;
    const author = (req.body.author || '').trim() || null;
    const module_ = (req.body.module || '').trim() || null;
    const system = (req.body.system || '').trim() || null;
    const tramites = parseTramites(req.body.tramite);
    const paso = (req.body.paso || '').trim() || null;
    const oficina = (req.body.oficina || '').trim() || null;
    if (!subject || !Number.isFinite(id)) return res.redirect('/casos');

    const exists = await pool.query('SELECT id FROM cases WHERE id=$1', [id]);
    if (exists.rows.length) return res.redirect('/casos?err=id_duplicado');

    await pool.query(`
      INSERT INTO cases (id, subject, description, general_status, status_mode, priority, owner, author, module, system, procedure_name, step, office, case_type, created_at, last_activity_at)
      VALUES ($1, $2, $3, 'Nuevo', 'auto', $4, $5, $6, $7, $8, $9, $10, $11, 'grouped', NOW(), NOW())
    `, [id, subject, description, priority, owner, author, module_, system, tramites.join(' | ') || null, paso, oficina]);

    await setCaseProcedures(id, tramites);

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

    const [metricsRes, childrenRes, activitiesRes, commentsRes, ownersRes, modulesRes, filesRes] = await Promise.all([
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
      pool.query('SELECT id, name, mimetype, size, uploaded_by, created_at, ticket_id FROM files WHERE case_id=$1 ORDER BY created_at DESC', [id]),
    ]);

    const caseTramites = await getCaseProcedures(id);

    const metrics = metricsRes.rows[0] || {};
    const total = metrics.total_children || 0;
    const closed = metrics.closed_children || 0;
    const pctResolved = total ? Math.round((closed / total) * 100) : 0;

    const cfg = await getAllConfigs();

    res.render('cases/detail', {
      title: `#${caseRow.id} — ${caseRow.subject}`,
      filters: {},
      caseRow, metrics,
      children: childrenRes.rows,
      activities: activitiesRes.rows,
      comments: commentsRes.rows,
      owners: ownersRes.rows.map(r => r.owner),
      modules: modulesRes.rows.map(r => r.module),
      files: filesRes.rows,
      caseTramites,
      pctResolved,
      ...cfg,
    });
  } catch (err) { next(err); }
});

// ---------- ARCHIVOS ----------
router.post('/:id/files', upload.array('files', 10), async (req, res, next) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    const ticketId = req.body.ticket_id ? parseInt(req.body.ticket_id, 10) : null;
    const actor = res.locals.currentUser?.fullname || 'usuario';

    for (const file of (req.files || [])) {
      await pool.query(
        `INSERT INTO files (case_id, ticket_id, name, mimetype, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [caseId, ticketId, file.originalname, file.mimetype, file.size, file.buffer, actor]
      );
    }

    if (req.files?.length) {
      await pool.query(
        `INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at) VALUES ($1,$2,'file_upload',$3,$4,NOW())`,
        [caseId, ticketId, actor, `${req.files.length} archivo(s) subido(s)`]
      );
      await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [caseId]);
    }

    res.redirect(`/casos/${caseId}#archivos`);
  } catch (err) { next(err); }
});

router.get('/:caseId/files/:fileId/download', async (req, res, next) => {
  try {
    const fileId = parseInt(req.params.fileId, 10);
    const { rows } = await pool.query('SELECT name, mimetype, data FROM files WHERE id=$1', [fileId]);
    if (!rows.length) return res.status(404).send('Archivo no encontrado');
    const f = rows[0];
    res.set('Content-Type', f.mimetype || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${f.name}"`);
    res.send(f.data);
  } catch (err) { next(err); }
});

router.post('/:caseId/files/:fileId/delete', async (req, res, next) => {
  try {
    const caseId = parseInt(req.params.caseId, 10);
    const fileId = parseInt(req.params.fileId, 10);
    await pool.query('DELETE FROM files WHERE id=$1 AND case_id=$2', [fileId, caseId]);
    res.redirect(`/casos/${caseId}#archivos`);
  } catch (err) { next(err); }
});

// ---------- COMENTARIOS, STATUS, ASOCIAR, DESASOCIAR, HIJOS ----------
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

router.post('/:id/tramites', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const prev = await getCaseProcedures(id);
    const tramites = parseTramites(req.body.tramite);
    if (prev.join(' | ') === tramites.join(' | ')) return res.redirect(`/casos/${id}`);

    await setCaseProcedures(id, tramites);
    const actor = res.locals.currentUser?.fullname || 'sistema';
    await pool.query(
      `INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1, 'tramites_change', $2, $3, NOW())`,
      [id, actor, `Trámites: ${prev.join(', ') || '—'} → ${tramites.join(', ') || '—'}`]
    );
    await pool.query('UPDATE cases SET last_activity_at=NOW() WHERE id=$1', [id]);
    res.redirect(`/casos/${id}`);
  } catch (err) { next(err); }
});

// Resolver el caso padre: lo cierra junto con todos sus hijos abiertos, que es
// lo que se espera al dar por terminado un caso agrupado.
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const prev = await pool.query('SELECT general_status FROM cases WHERE id=$1', [id]);
    if (!prev.rows.length) return res.redirect('/casos');

    const actor = res.locals.currentUser?.fullname || 'sistema';
    const closed = await pool.query(`
      UPDATE tickets SET status='Cerrada', finished_at=COALESCE(finished_at, NOW()),
             closed_at=COALESCE(closed_at, NOW()), updated_at=NOW()
      WHERE case_id=$1 AND status NOT IN ('Cerrada','Cerrado','Resuelta','Resuelto')
      RETURNING id
    `, [id]);
    await pool.query(
      `UPDATE cases SET general_status='Cerrado', status_mode='manual',
              resolved_at=COALESCE(resolved_at, NOW()), closed_at=COALESCE(closed_at, NOW()),
              last_activity_at=NOW() WHERE id=$1`,
      [id]
    );
    await pool.query(
      `INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1,'status_change',$2,$3,NOW())`,
      [id, actor, `${prev.rows[0].general_status || '?'} → Cerrado (${closed.rowCount} hijo/s cerrado/s)`]
    );
    res.redirect(req.body.back || `/casos/${id}`);
  } catch (err) { next(err); }
});

router.post('/:id/reopen', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const prev = await pool.query('SELECT general_status FROM cases WHERE id=$1', [id]);
    if (!prev.rows.length) return res.redirect('/casos');

    const actor = res.locals.currentUser?.fullname || 'sistema';
    await pool.query(
      `UPDATE cases SET general_status='En seguimiento', status_mode='manual',
              resolved_at=NULL, closed_at=NULL, last_activity_at=NOW() WHERE id=$1`,
      [id]
    );
    await pool.query(
      `INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1,'status_change',$2,$3,NOW())`,
      [id, actor, `${prev.rows[0].general_status || '?'} → En seguimiento (reabierto)`]
    );
    res.redirect(req.body.back || `/casos/${id}`);
  } catch (err) { next(err); }
});

router.post('/:id/edit', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    const exists = await pool.query('SELECT id FROM cases WHERE id=$1', [id]);
    if (!exists.rows.length) return res.redirect('/casos');

    const subject = (req.body.subject || '').trim();
    if (!subject) return res.redirect(`/casos/${id}?err=asunto_vacio`);

    const nz = (v) => { const x = (v || '').trim(); return x || null; };
    await pool.query(`
      UPDATE cases SET subject=$1, description=$2, priority=$3, owner=$4, author=$5,
             module=$6, system=$7, step=$8, office=$9, last_activity_at=NOW()
      WHERE id=$10
    `, [
      subject, nz(req.body.description), nz(req.body.priority), nz(req.body.owner),
      nz(req.body.author), nz(req.body.module), nz(req.body.system),
      nz(req.body.paso), nz(req.body.oficina), id,
    ]);

    // Los tramites solo se tocan si el form los mando (el modal siempre los incluye).
    if ('tramite' in req.body) await setCaseProcedures(id, parseTramites(req.body.tramite));

    const actor = res.locals.currentUser?.fullname || 'sistema';
    await pool.query(
      `INSERT INTO activities (case_id, kind, actor, message, occurred_at) VALUES ($1,'case_edited',$2,$3,NOW())`,
      [id, actor, `Caso editado: ${subject.slice(0, 120)}`]
    );
    res.redirect(`/casos/${id}`);
  } catch (err) { next(err); }
});

// Eliminar el caso. Los hijos caen por el ON DELETE CASCADE del schema, asi que
// se avisa cuantos son en la confirmacion de la vista.
router.post('/:id/delete', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.redirect('/casos');
    await pool.query('DELETE FROM cases WHERE id=$1', [id]);
    res.redirect('/casos');
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
    const description = (req.body.description || '').trim() || null;
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
      INSERT INTO tickets (id, case_id, subject, description, priority, owner, author, ticket_type, status, procedure_name, step, office, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Asignada', $9, $10, $11, NOW())
    `, [id, caseId, subject, description, priority, owner, author, ticket_type, tramite, paso, oficina]);

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
