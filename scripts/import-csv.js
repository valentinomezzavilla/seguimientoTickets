/**
 * Importa issues.csv al modelo padre (case) → hijo (ticket).
 *
 * Estrategia:
 *   1. Cada fila del CSV es un ticket (hijo).
 *   2. Si tiene "Tarea padre" → se enlaza a ese case.
 *   3. Si el ticket mismo es referenciado como padre por otros → sus datos poblan el case.
 *   4. Si un padre es referenciado pero no está en el CSV → se crea un case "external_parent" con el ID y el asunto.
 *   5. Filas sin padre y sin hijos → se envuelven en un case "individual" para uniformar la UX.
 */

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { parse } = require('csv-parse/sync');
const db = require('../db');

const CSV_PATH = process.argv[2] || path.join(__dirname, '..', 'issues.csv');
if (!fs.existsSync(CSV_PATH)) {
  console.error('CSV no encontrado:', CSV_PATH);
  process.exit(1);
}

console.log('Leyendo', CSV_PATH);
const buffer = fs.readFileSync(CSV_PATH);
// El CSV viene en latin-1 (windows-1252) con delimitador ;
const text = iconv.decode(buffer, 'latin1');
const rows = parse(text, {
  delimiter: ';',
  columns: true,
  skip_empty_lines: true,
  relax_column_count: true,
  relax_quotes: true,
});
console.log('Filas leídas:', rows.length);

// Mapeo de columnas (usamos los nombres que aparecen tal cual en el header)
const COL = {
  id:              '#',
  project:         'Proyecto',
  type:            'Tipo',
  parentId:        'Tarea padre',
  parentSubject:   'Asunto de la tarea padre',
  status:          'Estado',
  priority:        'Prioridad',
  subject:         'Asunto',
  author:          'Autor',
  owner:           'Asignado a',
  updated:         'Actualizado',
  category:        'Categoría',
  targetVersion:   'Versión prevista',
  startDate:       'Fecha de inicio',
  endDate:         'Fecha fin',
  createdAt:       'Creado',
  closedAt:        'Cerrada',
  lastUpdatedBy:   'Última actualización de',
  related:         'Peticiones relacionadas',
  files:           'Ficheros',
  mainItem:        'Ítem principal',
  priorityAssigned:'Prioridad Asignada',
  module:          'Módulo',
  itemType:        'Tipo de ítem',
  office:          '0ficina',
  officeCC:        'Oficina - CC',
  contactChannel:  'Canal de contacto',
  systemModule:    'Sistema y módulo',
  procedureNums:   'Nro./s de Trámite/s',
  environment:     'Ambiente',
  procedureName:   'Trámite',
  motives:         'Motivos',
  motive:          'Motivo',
  motiveInterop:   'Motivo Interoperabilidad',
  motiveMirc:      'Motivo MiRC',
  motivesVarios:   'Motivos varios',
  suacCode:        'Código SUAC',
  requestNumber:   'N° Solicitud',
  actType:         'Tipo de acta',
  referenceItem:   'Item de referencia',
  deployedProd:    'Desplegado en Producción',
  moreCitizenInfo: 'Mas información del ciudadano',
  facebookUser:    'Nombre usuario Facebook',
  frequency:       'Frecuencia',
  cuil:            'CUIL Cliente RC',
  internetSpeed:   'Velocidad Internet Baj/Sub',
  bandeja:         'Bandeja',
  step:            'Paso',
  section:         'Sección',
  motivesSisol:    'Motivos SiSol',
  actTypeSisol:    'Tipo de acta SiSol',
  motiveRcd:       'Motivo RCD',
  moduleRcd:       'Modulo Rcd',
  statusSisol:     'Estado SiSol',
  system:          'Sistema',
  motivesRcCba:    'Motivos RC CORDOBA',
  moduleGT:        'Modulo Generales y Tramites',
  postImpl:        'Post-Implementación',
  agent:           'Agente',
  private:         'Privada',
};

// Meses español para parseo de fechas "31 Julio 2026 16:15"
const MESES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };
function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  // "31 Julio 2026 16:15"  o  "31 Julio 2026"
  const m = t.match(/^(\d{1,2})\s+([A-Za-zñáéíóú]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = MESES[m[2].toLowerCase()];
    const yy = parseInt(m[3], 10);
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mi = m[5] ? parseInt(m[5], 10) : 0;
    const se = m[6] ? parseInt(m[6], 10) : 0;
    if (mm) return `${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')} ${String(hh).padStart(2,'0')}:${String(mi).padStart(2,'0')}:${String(se).padStart(2,'0')}`;
  }
  return t; // dejar tal cual si no matchea
}

const get = (r, key) => (r[COL[key]] || '').toString().trim();
const nz = (v) => v === '' ? null : v;

const isCriticalPriority = (p) => {
  if (!p) return false;
  const s = p.toLowerCase();
  return s.includes('inmediat') || s.includes('muy alta') || s.includes('urgent') || s.includes('crític') || s.includes('critic');
};

// Estado calculado del caso a partir de sus hijos
function computeCaseStatus(children) {
  if (!children.length) return 'Nuevo';
  const norm = children.map(c => (c.status || '').toLowerCase());
  const allClosed = norm.every(s => s.includes('cerrad') || s.includes('resuelt'));
  if (allClosed) return 'Resuelto';
  if (norm.some(s => s.includes('en progreso'))) return 'En seguimiento';
  if (norm.some(s => s.includes('pendient') || s.includes('verificar'))) return 'Pendiente';
  if (norm.some(s => s.includes('asignada') || s.includes('nueva') || s.includes('abierta'))) return 'En seguimiento';
  return 'En seguimiento';
}

// Prioridad "más alta" entre hijos
const PRIO_RANK = { 'inmediata - 8hrs': 5, 'muy alta': 4, 'alta': 3, 'media': 2, 'baja': 1 };
function computeCasePriority(children) {
  let best = null, bestRank = -1;
  for (const c of children) {
    const r = PRIO_RANK[(c.priority || '').toLowerCase()] ?? 0;
    if (r > bestRank) { bestRank = r; best = c.priority; }
  }
  return best;
}

// 1. Indexar filas por ID y detectar padres referenciados
const byId = new Map();
for (const r of rows) {
  const id = parseInt(get(r, 'id'), 10);
  if (!Number.isFinite(id)) continue;
  byId.set(id, r);
}

const parentIds = new Set();
for (const r of rows) {
  const p = get(r, 'parentId');
  if (p) {
    const pid = parseInt(p, 10);
    if (Number.isFinite(pid)) parentIds.add(pid);
  }
}

console.log('Padres referenciados distintos:', parentIds.size);
console.log('Padres presentes en el CSV con datos propios:', [...parentIds].filter(id => byId.has(id)).length);

// 2. Preparar sentencias
const insertCase = db.prepare(`
  INSERT OR REPLACE INTO cases
    (id, subject, description, general_status, status_mode, priority, owner, team, author,
     module, system, case_type, tags, created_at, last_activity_at)
  VALUES
    (@id, @subject, @description, @general_status, 'auto', @priority, @owner, @team, @author,
     @module, @system, @case_type, @tags, @created_at, @last_activity_at)
`);

const insertTicket = db.prepare(`
  INSERT OR REPLACE INTO tickets (
    id, case_id, project, ticket_type, subject, description, status, priority, priority_assigned,
    owner, author, last_updated_by, category, target_version, module, item_type, office, office_cc,
    contact_channel, system_module, procedure_nums, environment, procedure_name, motives, motive,
    motive_interop, motive_mirc, motives_varios, suac_code, request_number, act_type, reference_item,
    deployed_prod, more_citizen_info, facebook_user, frequency, cuil, internet_speed, bandeja, step,
    section, motives_sisol, act_type_sisol, motive_rcd, module_rcd, status_sisol, system,
    motives_rc_cba, module_gt, post_impl, agent, private, files, is_critical,
    created_at, started_at, finished_at, closed_at, updated_at
  ) VALUES (
    @id, @case_id, @project, @ticket_type, @subject, @description, @status, @priority, @priority_assigned,
    @owner, @author, @last_updated_by, @category, @target_version, @module, @item_type, @office, @office_cc,
    @contact_channel, @system_module, @procedure_nums, @environment, @procedure_name, @motives, @motive,
    @motive_interop, @motive_mirc, @motives_varios, @suac_code, @request_number, @act_type, @reference_item,
    @deployed_prod, @more_citizen_info, @facebook_user, @frequency, @cuil, @internet_speed, @bandeja, @step,
    @section, @motives_sisol, @act_type_sisol, @motive_rcd, @module_rcd, @status_sisol, @system,
    @motives_rc_cba, @module_gt, @post_impl, @agent, @private, @files, @is_critical,
    @created_at, @started_at, @finished_at, @closed_at, @updated_at
  )
`);

const insertActivity = db.prepare(`
  INSERT INTO activities (case_id, ticket_id, kind, actor, message, occurred_at)
  VALUES (@case_id, @ticket_id, @kind, @actor, @message, @occurred_at)
`);

// Convierte una fila CSV a objeto ticket
function rowToTicket(r, caseId) {
  const priority = nz(get(r, 'priority'));
  return {
    id: parseInt(get(r, 'id'), 10),
    case_id: caseId,
    project: nz(get(r, 'project')),
    ticket_type: nz(get(r, 'type')),
    subject: get(r, 'subject') || '(sin asunto)',
    description: null,
    status: nz(get(r, 'status')),
    priority,
    priority_assigned: nz(get(r, 'priorityAssigned')),
    owner: nz(get(r, 'owner')),
    author: nz(get(r, 'author')),
    last_updated_by: nz(get(r, 'lastUpdatedBy')),
    category: nz(get(r, 'category')),
    target_version: nz(get(r, 'targetVersion')),
    module: nz(get(r, 'module')),
    item_type: nz(get(r, 'itemType')),
    office: nz(get(r, 'office')),
    office_cc: nz(get(r, 'officeCC')),
    contact_channel: nz(get(r, 'contactChannel')),
    system_module: nz(get(r, 'systemModule')),
    procedure_nums: nz(get(r, 'procedureNums')),
    environment: nz(get(r, 'environment')),
    procedure_name: nz(get(r, 'procedureName')),
    motives: nz(get(r, 'motives')),
    motive: nz(get(r, 'motive')),
    motive_interop: nz(get(r, 'motiveInterop')),
    motive_mirc: nz(get(r, 'motiveMirc')),
    motives_varios: nz(get(r, 'motivesVarios')),
    suac_code: nz(get(r, 'suacCode')),
    request_number: nz(get(r, 'requestNumber')),
    act_type: nz(get(r, 'actType')),
    reference_item: nz(get(r, 'referenceItem')),
    deployed_prod: nz(get(r, 'deployedProd')),
    more_citizen_info: nz(get(r, 'moreCitizenInfo')),
    facebook_user: nz(get(r, 'facebookUser')),
    frequency: nz(get(r, 'frequency')),
    cuil: nz(get(r, 'cuil')),
    internet_speed: nz(get(r, 'internetSpeed')),
    bandeja: nz(get(r, 'bandeja')),
    step: nz(get(r, 'step')),
    section: nz(get(r, 'section')),
    motives_sisol: nz(get(r, 'motivesSisol')),
    act_type_sisol: nz(get(r, 'actTypeSisol')),
    motive_rcd: nz(get(r, 'motiveRcd')),
    module_rcd: nz(get(r, 'moduleRcd')),
    status_sisol: nz(get(r, 'statusSisol')),
    system: nz(get(r, 'system')),
    motives_rc_cba: nz(get(r, 'motivesRcCba')),
    module_gt: nz(get(r, 'moduleGT')),
    post_impl: nz(get(r, 'postImpl')),
    agent: nz(get(r, 'agent')),
    private: nz(get(r, 'private')),
    files: nz(get(r, 'files')),
    is_critical: isCriticalPriority(priority) ? 1 : 0,
    created_at: parseDate(get(r, 'createdAt')),
    started_at: parseDate(get(r, 'startDate')),
    finished_at: parseDate(get(r, 'endDate')),
    closed_at:   parseDate(get(r, 'closedAt')),
    updated_at:  parseDate(get(r, 'updated')),
  };
}

// 3. Construir plan de casos
//    caseKey: number (id de padre real) o string 'solo:<ticketId>' para individuales
const plan = new Map(); // caseId -> { caseRow, childrenRows: [rawRow], caseType }
const usedIds = new Set(); // para no colisionar cuando envolvemos individuales

// 3a. Cases con hijos declarados
for (const pid of parentIds) {
  const kids = rows.filter(r => parseInt(get(r, 'parentId'), 10) === pid);
  const parentRow = byId.get(pid); // puede no existir
  const parentSubject = parentRow ? get(parentRow, 'subject') : (kids[0] ? get(kids[0], 'parentSubject') : `Caso #${pid}`);
  plan.set(pid, {
    caseType: parentRow ? 'grouped' : 'external_parent',
    parentRow,
    childrenRows: kids,
    subject: parentSubject || `Caso #${pid}`,
  });
  usedIds.add(pid);
  for (const k of kids) usedIds.add(parseInt(get(k, 'id'), 10));
}

// 3b. Filas sueltas → case individual (id = id del ticket)
for (const r of rows) {
  const id = parseInt(get(r, 'id'), 10);
  if (!Number.isFinite(id)) continue;
  if (usedIds.has(id)) continue;
  plan.set(id, {
    caseType: 'individual',
    parentRow: r,
    childrenRows: [r],
    subject: get(r, 'subject') || `Ticket #${id}`,
  });
  usedIds.add(id);
}

console.log('Casos a crear:', plan.size);

// 4. Insertar en transacción
const importAll = db.transaction(() => {
  db.prepare('DELETE FROM activities').run();
  db.prepare('DELETE FROM comments').run();
  db.prepare('DELETE FROM files').run();
  db.prepare('DELETE FROM tickets').run();
  db.prepare('DELETE FROM cases').run();

  let casesInserted = 0, ticketsInserted = 0, activitiesInserted = 0;

  for (const [caseId, p] of plan) {
    const kids = p.childrenRows.map(r => rowToTicket(r, caseId));
    const casePriority = computeCasePriority(kids);
    const caseStatus = computeCaseStatus(kids);
    const owners = [...new Set(kids.map(k => k.owner).filter(Boolean))];
    const modules = [...new Set(kids.map(k => k.module).filter(Boolean))];
    const systems = [...new Set(kids.map(k => k.system || k.system_module).filter(Boolean))];
    const authors = [...new Set(kids.map(k => k.author).filter(Boolean))];
    const createdCandidates = kids.map(k => k.created_at).filter(Boolean).sort();
    const updatedCandidates = kids.map(k => k.updated_at).filter(Boolean).sort();

    const parentRow = p.parentRow;
    const caseRecord = {
      id: caseId,
      subject: (p.subject || `Caso #${caseId}`).slice(0, 500),
      description: parentRow ? null : (p.caseType === 'external_parent' ? 'Padre referenciado no presente en la importación original.' : null),
      general_status: caseStatus,
      priority: casePriority,
      owner: owners[0] || null,
      team: null,
      author: authors[0] || null,
      module: modules.join(', ') || null,
      system: systems.join(', ') || null,
      case_type: p.caseType,
      tags: null,
      created_at: (parentRow ? parseDate(get(parentRow, 'createdAt')) : createdCandidates[0]) || null,
      last_activity_at: updatedCandidates[updatedCandidates.length - 1] || null,
    };

    insertCase.run(caseRecord);
    casesInserted++;

    for (const k of kids) {
      insertTicket.run(k);
      ticketsInserted++;

      insertActivity.run({
        case_id: caseId,
        ticket_id: k.id,
        kind: p.caseType === 'individual' ? 'case_created' : 'child_created',
        actor: k.author,
        message: k.subject,
        occurred_at: k.created_at || caseRecord.created_at || new Date().toISOString(),
      });
      activitiesInserted++;

      if (k.closed_at) {
        insertActivity.run({
          case_id: caseId,
          ticket_id: k.id,
          kind: 'close',
          actor: k.last_updated_by || k.owner,
          message: `Ticket cerrado`,
          occurred_at: k.closed_at,
        });
        activitiesInserted++;
      }
    }
  }

  console.log(`Cases: ${casesInserted}  Tickets: ${ticketsInserted}  Activities: ${activitiesInserted}`);
});

importAll();
console.log('Importación completa.');
