// Genera el exportable en Excel (.xlsx) con formato: hoja de Resumen mas una
// hoja por alcance elegido. Se separa de las rutas porque la parte de estilo es
// larga y no tiene nada que ver con el ruteo.
const ExcelJS = require('exceljs');

// Paleta alineada con la app (public/css/app.css).
const AZUL = 'FF232C6B';   // encabezados
const VIOLETA = 'FF6366F1'; // titulos de seccion
const GRIS_SUAVE = 'FFF3F4F6';
const CEBRA = 'FFFAFAFB';
const BORDE = 'FFE5E7EB';

const CERRADOS = ['Cerrada', 'Cerrado', 'Resuelta', 'Resuelto'];
const esCerrado = (s) => CERRADOS.includes(s);

const thin = { style: 'thin', color: { argb: BORDE } };
const bordeCompleto = { top: thin, left: thin, bottom: thin, right: thin };

// Colores de estado, para que se lean de un vistazo igual que en la app.
function colorEstado(estado) {
  const t = (estado || '').toLowerCase();
  if (t.includes('cerrad') || t.includes('resuelt')) return { bg: 'FFDCFCE7', fg: 'FF166534' };
  if (t.includes('progreso')) return { bg: 'FFDBEAFE', fg: 'FF1E40AF' };
  if (t.includes('pendient')) return { bg: 'FFFEF3C7', fg: 'FF92400E' };
  if (t.includes('verificar')) return { bg: 'FFEDE9FE', fg: 'FF5B21B6' };
  if (t.includes('asignada') || t.includes('abierta') || t.includes('nuev')) return { bg: 'FFE0E7FF', fg: 'FF3730A3' };
  return null;
}

function colorPrioridad(prioridad) {
  const t = (prioridad || '').toLowerCase();
  if (t.includes('inmediat')) return { bg: 'FFFEE2E2', fg: 'FF991B1B' };
  if (t.includes('muy alta')) return { bg: 'FFFFE4E6', fg: 'FFBE123C' };
  if (t.includes('alta')) return { bg: 'FFFFEDD5', fg: 'FF9A3412' };
  if (t.includes('media')) return { bg: 'FFFEF9C3', fg: 'FF854D0E' };
  if (t.includes('baja')) return { bg: GRIS_SUAVE, fg: 'FF4B5563' };
  return null;
}

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

// Ajusta el ancho de cada columna al contenido real, con topes para que una
// descripcion larga no genere una columna gigante. Recorre las filas a mano
// porque col.eachCell saltea las celdas vacias, y una columna enteramente vacia
// se quedaria sin ancho (ni siquiera el del encabezado).
// min = 10 a proposito: ExcelJS omite del archivo los anchos que valen
// exactamente 9 (su default), y esas columnas terminan con el ancho por defecto
// de Excel en vez del calculado.
function autoAncho(sheet, filaEncabezado, { min = 10, max = 48 } = {}) {
  const ultimaFila = sheet.rowCount;
  for (let c = 1; c <= sheet.columnCount; c++) {
    let largo = min;
    for (let r = filaEncabezado; r <= ultimaFila; r++) {
      const v = sheet.getRow(r).getCell(c).value;
      if (v == null) continue;
      const txt = v instanceof Date ? 'dd/mm/aaaa hh:mm' : String(v.text ?? v);
      // El encabezado usa wrapText, asi que no debe forzar el ancho completo.
      const efectivo = r === filaEncabezado ? Math.min(txt.length + 2, 16) : txt.length + 2;
      largo = Math.max(largo, efectivo);
    }
    sheet.getColumn(c).width = Math.min(largo, max);
  }
}

function tituloHoja(sheet, titulo, subtitulo, anchoCols) {
  sheet.mergeCells(1, 1, 1, anchoCols);
  const t = sheet.getCell(1, 1);
  t.value = titulo;
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(2, 1, 2, anchoCols);
  const s = sheet.getCell(2, 1);
  s.value = subtitulo;
  s.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF6B7280' } };
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 18;
}

// Escribe una tabla con encabezado de color, cebra, autofiltro y panel fijo.
function escribirTabla(sheet, filaEncabezado, columnas, filas, pintarCelda) {
  const head = sheet.getRow(filaEncabezado);
  columnas.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = bordeCompleto;
  });
  head.height = 26;

  filas.forEach((fila, r) => {
    const row = sheet.getRow(filaEncabezado + 1 + r);
    columnas.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.get(fila);
      cell.value = v == null || v === '' ? null : v;
      cell.font = { name: 'Calibri', size: 10 };
      cell.border = bordeCompleto;
      cell.alignment = {
        vertical: 'top',
        horizontal: c.align || (typeof v === 'number' ? 'center' : 'left'),
        wrapText: !!c.wrap,
      };
      if (c.numFmt) cell.numFmt = c.numFmt;
      if (v instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
      if (r % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEBRA } };
      if (pintarCelda) pintarCelda(cell, c, fila);
    });
  });

  if (filas.length) {
    sheet.autoFilter = {
      from: { row: filaEncabezado, column: 1 },
      to: { row: filaEncabezado + filas.length, column: columnas.length },
    };
  }
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: filaEncabezado }];
  autoAncho(sheet, filaEncabezado);
}

// Pinta estado y prioridad como si fueran las etiquetas de la app.
function pintarEstados(cell, col, fila) {
  void fila;
  if (col.tipo === 'estado') {
    const c = colorEstado(cell.value);
    if (c) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.bg } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: c.fg } };
      cell.alignment = { ...cell.alignment, horizontal: 'center' };
    }
  } else if (col.tipo === 'prioridad') {
    const c = colorPrioridad(cell.value);
    if (c) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.bg } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: c.fg } };
      cell.alignment = { ...cell.alignment, horizontal: 'center' };
    }
  }
}

// ---------- HOJA RESUMEN ----------
function hojaResumen(wb, { cases, tickets, incluyePadres, incluyeHijos, filtros, usuario }) {
  const sheet = wb.addWorksheet('Resumen', {
    properties: { tabColor: { argb: AZUL } },
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const ahora = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const generado = `${p2(ahora.getDate())}/${p2(ahora.getMonth() + 1)}/${ahora.getFullYear()} a las ${p2(ahora.getHours())}:${p2(ahora.getMinutes())}`;
  tituloHoja(sheet, 'Seguimiento de Tickets — Resumen', `Generado el ${generado} por ${usuario}`, 4);

  let fila = 4;
  const etiqueta = (texto, valor, opts = {}) => {
    const a = sheet.getCell(fila, 1);
    a.value = texto;
    a.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF374151' } };
    a.alignment = { vertical: 'middle', indent: 1 };
    sheet.mergeCells(fila, 2, fila, 4);
    const b = sheet.getCell(fila, 2);
    b.value = valor;
    b.font = { name: 'Calibri', size: opts.grande ? 14 : 10, bold: !!opts.grande, color: { argb: opts.color || 'FF111827' } };
    b.alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(fila).height = opts.grande ? 22 : 16;
    fila++;
  };

  const seccion = (texto) => {
    fila++;
    sheet.mergeCells(fila, 1, fila, 4);
    const c = sheet.getCell(fila, 1);
    c.value = texto;
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VIOLETA } };
    c.alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(fila).height = 20;
    fila++;
  };

  seccion('ALCANCE DEL REPORTE');
  const partes = [];
  if (incluyePadres) partes.push('Tickets padre');
  if (incluyeHijos) partes.push('Tickets hijos (incidentes)');
  etiqueta('Contenido', partes.join(' + '));
  const activos = Object.entries(filtros).filter(([, v]) => v);
  etiqueta('Filtros aplicados', activos.length
    ? activos.map(([k, v]) => `${k}: ${v}`).join('  ·  ')
    : 'Ninguno — se exportaron todos los registros');

  // Un bloque de metricas por cada alcance incluido.
  const bloqueMetricas = (titulo, filasDatos, campoEstado) => {
    const total = filasDatos.length;
    const cerrados = filasDatos.filter(r => esCerrado(r[campoEstado])).length;
    const pct = total ? Math.round((cerrados / total) * 100) : 0;
    seccion(titulo);
    etiqueta('Total', total, { grande: true });
    etiqueta('Resueltos / cerrados', cerrados, { grande: true, color: 'FF166534' });
    etiqueta('Pendientes', total - cerrados, { grande: true, color: 'FF9A3412' });
    etiqueta('% resuelto', total ? pct / 100 : 0, { grande: true, color: 'FF3730A3' });
    sheet.getCell(fila - 1, 2).numFmt = '0%';
  };

  if (incluyePadres) bloqueMetricas('TICKETS PADRE', cases, 'general_status');
  if (incluyeHijos) {
    bloqueMetricas('TICKETS HIJOS (INCIDENTES)', tickets, 'status');
    etiqueta('Críticos', tickets.filter(t => t.is_critical).length, { grande: true, color: 'FF991B1B' });
  }

  // Desgloses sobre el alcance principal (hijos si estan, si no padres).
  const base = incluyeHijos ? tickets : cases;
  const campoEstado = incluyeHijos ? 'status' : 'general_status';
  const totalBase = base.length;

  const desglose = (titulo, campo) => {
    const map = new Map();
    for (const r of base) {
      const k = r[campo] || '(sin asignar)';
      map.set(k, (map.get(k) || 0) + 1);
    }
    seccion(titulo);
    const head = sheet.getRow(fila);
    ['Valor', 'Cantidad', '% del total'].forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
      c.border = bordeCompleto;
    });
    fila++;
    [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n], i) => {
      const row = sheet.getRow(fila);
      const cV = row.getCell(1); cV.value = k;
      const cN = row.getCell(2); cN.value = n;
      const cP = row.getCell(3); cP.value = totalBase ? n / totalBase : 0; cP.numFmt = '0%';
      [cV, cN, cP].forEach((c, j) => {
        c.font = { name: 'Calibri', size: 10 };
        c.border = bordeCompleto;
        c.alignment = { vertical: 'middle', horizontal: j === 0 ? 'left' : 'center', indent: j === 0 ? 1 : 0 };
        if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEBRA } };
      });
      if (campo === campoEstado) {
        const col = colorEstado(k);
        if (col) {
          cV.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.bg } };
          cV.font = { name: 'Calibri', size: 10, bold: true, color: { argb: col.fg } };
        }
      }
      fila++;
    });
  };

  desglose('POR ESTADO', campoEstado);
  desglose('POR PRIORIDAD', 'priority');
  desglose('POR RESPONSABLE', 'owner');

  sheet.getColumn(1).width = 26;
  sheet.getColumn(2).width = 22;
  sheet.getColumn(3).width = 16;
  sheet.getColumn(4).width = 16;
  return sheet;
}

// ---------- HOJA TICKETS PADRE ----------
const COLS_PADRE = [
  { header: '#ID', get: c => c.id, align: 'center' },
  { header: 'Asunto', get: c => c.subject, wrap: true },
  { header: 'Estado', get: c => c.general_status, tipo: 'estado' },
  { header: 'Prioridad', get: c => c.priority, tipo: 'prioridad' },
  { header: 'Responsable', get: c => c.owner },
  { header: 'Autor', get: c => c.author },
  { header: 'Módulo', get: c => c.module },
  { header: 'Sistema', get: c => c.system },
  { header: 'Trámites', get: c => c.tramites || c.procedure_name, wrap: true },
  { header: 'Paso', get: c => c.step },
  { header: 'Oficina', get: c => c.office },
  { header: 'Hijos', get: c => c.total_children || 0, align: 'center' },
  { header: 'Abiertos', get: c => c.open_children || 0, align: 'center' },
  { header: 'En progreso', get: c => c.inprogress_children || 0, align: 'center' },
  { header: 'Pendientes', get: c => c.pending_children || 0, align: 'center' },
  { header: 'Cerrados', get: c => c.closed_children || 0, align: 'center' },
  { header: 'Críticos', get: c => c.critical_children || 0, align: 'center' },
  { header: '% resuelto', get: c => (c.total_children ? (c.closed_children || 0) / c.total_children : null), numFmt: '0%', align: 'center' },
  { header: 'Creado', get: c => toDate(c.created_at) },
  { header: 'Última actividad', get: c => toDate(c.last_child_activity_at || c.last_activity_at) },
];

// ---------- HOJA TICKETS HIJOS ----------
const COLS_HIJO = [
  { header: '#ID', get: t => t.id, align: 'center' },
  { header: 'Caso padre', get: t => t.case_id, align: 'center' },
  { header: 'Asunto del caso', get: t => t.case_subject, wrap: true },
  { header: 'Asunto', get: t => t.subject, wrap: true },
  { header: 'Estado', get: t => t.status, tipo: 'estado' },
  { header: 'Prioridad', get: t => t.priority, tipo: 'prioridad' },
  { header: 'Responsable', get: t => t.owner },
  { header: 'Autor', get: t => t.author },
  { header: 'Tipo', get: t => t.ticket_type },
  { header: 'Módulo', get: t => t.module },
  { header: 'Sistema', get: t => t.system || t.system_module },
  { header: 'Trámite', get: t => t.procedure_name },
  { header: 'Paso', get: t => t.step },
  { header: 'Sección', get: t => t.section },
  { header: 'Oficina', get: t => t.office },
  { header: 'Canal', get: t => t.contact_channel },
  { header: 'Ambiente', get: t => t.environment },
  { header: 'Nro. de trámite', get: t => t.procedure_nums },
  { header: 'Código SUAC', get: t => t.suac_code },
  { header: 'CUIL', get: t => t.cuil },
  { header: 'Crítico', get: t => (t.is_critical ? 'Sí' : 'No'), align: 'center' },
  { header: 'Creado', get: t => toDate(t.created_at) },
  { header: 'Inicio', get: t => toDate(t.started_at) },
  { header: 'Fin', get: t => toDate(t.finished_at) },
  { header: 'Cerrado', get: t => toDate(t.closed_at) },
  { header: 'Actualizado', get: t => toDate(t.updated_at) },
];

function hojaDetalle(wb, nombre, titulo, subtitulo, columnas, filas, tabColor) {
  const sheet = wb.addWorksheet(nombre, {
    properties: { tabColor: { argb: tabColor } },
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  tituloHoja(sheet, titulo, subtitulo, columnas.length);
  escribirTabla(sheet, 4, columnas, filas, pintarEstados);
  if (!filas.length) {
    const c = sheet.getCell(5, 1);
    c.value = 'Sin registros para los filtros aplicados';
    c.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF9CA3AF' } };
  }
  return sheet;
}

/**
 * Arma el workbook completo.
 * scope: 'padres' | 'hijos' | 'ambos'
 */
async function construirWorkbook({ scope, cases, tickets, filtros, usuario }) {
  const incluyePadres = scope === 'padres' || scope === 'ambos';
  const incluyeHijos = scope === 'hijos' || scope === 'ambos';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Seguimiento Tickets';
  wb.created = new Date();

  const activos = Object.entries(filtros).filter(([, v]) => v);
  const subtitulo = activos.length
    ? `Filtros: ${activos.map(([k, v]) => `${k}=${v}`).join(', ')}`
    : 'Sin filtros — todos los registros';

  hojaResumen(wb, { cases, tickets, incluyePadres, incluyeHijos, filtros, usuario });

  if (incluyePadres) {
    hojaDetalle(wb, 'Tickets padre', `Tickets padre (${cases.length})`, subtitulo, COLS_PADRE, cases, VIOLETA);
  }
  if (incluyeHijos) {
    hojaDetalle(wb, 'Tickets hijos', `Tickets hijos — incidentes (${tickets.length})`, subtitulo, COLS_HIJO, tickets, 'FF16A34A');
  }

  return wb;
}

module.exports = { construirWorkbook, COLS_PADRE, COLS_HIJO, colorEstado, colorPrioridad };
