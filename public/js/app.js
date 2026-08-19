// Filas clicables
document.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a,button,form,input')) {
    window.location = tr.dataset.href;
  }
});

// Búsqueda de tickets para asociar
const searchInput = document.querySelector('#assoc-search');
if (searchInput) {
  const results = document.querySelector('#assoc-results');
  let t;
  searchInput.addEventListener('input', () => {
    clearTimeout(t);
    const q = searchInput.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    t = setTimeout(async () => {
      const r = await fetch('/api/tickets/search?q=' + encodeURIComponent(q));
      const rows = await r.json();
      results.innerHTML = rows.map(row => `
        <div class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <span class="mono text-muted">#${row.id}</span>
            <span class="ms-2">${row.subject || ''}</span>
            <span class="badge bg-light text-dark ms-1">${row.status || ''}</span>
          </div>
          <form method="post" action="" class="assoc-form">
            <input type="hidden" name="ticket_id" value="${row.id}">
            <button class="btn btn-sm btn-primary">Asociar</button>
          </form>
        </div>`).join('') || '<div class="text-muted small p-2">Sin resultados</div>';
      const caseId = searchInput.dataset.caseId;
      results.querySelectorAll('form.assoc-form').forEach(f => f.action = `/casos/${caseId}/associate`);
    }, 200);
  });
}

// Selector de multiples valores (chips). Cada chip aporta un input oculto con
// el mismo `name`, asi el form manda el campo repetido y el backend lo recibe
// como array. Usado para los tramites del ticket padre.
function initMultiPicker(box) {
  if (box.dataset.multiReady) return;
  box.dataset.multiReady = '1';

  const name = box.dataset.name;
  const chips = box.querySelector('[data-multi-chips]');
  const input = box.querySelector('[data-multi-input]');
  const addBtn = box.querySelector('[data-multi-add]');
  const empty = box.querySelector('[data-multi-empty]');

  const values = () => Array.from(chips.querySelectorAll('input[type=hidden]')).map(i => i.value);
  const refresh = () => { if (empty) empty.hidden = chips.children.length > 0; };

  function add(raw) {
    const v = (raw || '').trim();
    if (!v) return;
    if (values().some(x => x.toLowerCase() === v.toLowerCase())) { input.value = ''; return; }

    const chip = document.createElement('span');
    chip.className = 'multi-chip';

    const label = document.createElement('span');
    label.textContent = v;
    chip.appendChild(label);

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = name;
    hidden.value = v;
    chip.appendChild(hidden);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'multi-chip-x';
    del.setAttribute('aria-label', 'Quitar ' + v);
    del.innerHTML = '&times;';
    del.addEventListener('click', () => { chip.remove(); refresh(); });
    chip.appendChild(del);

    chips.appendChild(chip);
    input.value = '';
    refresh();
  }

  try {
    JSON.parse(box.dataset.values || '[]').forEach(add);
  } catch (e) { /* sin valores iniciales */ }

  addBtn?.addEventListener('click', () => { add(input.value); input.focus(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); }
    else if (e.key === 'Backspace' && !input.value && chips.lastElementChild) {
      chips.lastElementChild.remove(); refresh();
    }
  });
  // Elegir una opcion del datalist con el mouse dispara `change`.
  input.addEventListener('change', () => { if (input.value.trim()) add(input.value); });

  refresh();
}

document.querySelectorAll('[data-multi]').forEach(initMultiPicker);

// Sidebar de filtros plegable. La preferencia se guarda en localStorage para
// que no haya que cerrarlo en cada navegacion.
(function () {
  const ticketera = document.querySelector('.ticketera');
  const toggle = document.getElementById('filter-toggle');
  if (!ticketera || !toggle) return;

  const cerrar = document.getElementById('filter-close');
  const CLAVE = 'filtros-ocultos';
  const chico = () => window.matchMedia('(max-width: 768px)').matches;

  function aplicar(oculto, animar) {
    if (!animar) ticketera.classList.add('no-anim');
    ticketera.classList.toggle('filters-hidden', oculto);
    toggle.setAttribute('aria-expanded', String(!oculto));
    if (!animar) {
      // Fuerza el reflow antes de rehabilitar la animacion, si no la clase
      // no-anim se quita en el mismo frame y la transicion igual se dispara.
      void ticketera.offsetWidth;
      ticketera.classList.remove('no-anim');
    }
  }

  // Estado inicial: en mobile arranca siempre cerrado (ocupa toda la pantalla).
  const guardado = localStorage.getItem(CLAVE) === '1';
  aplicar(chico() ? true : guardado, false);

  function alternar() {
    const oculto = !ticketera.classList.contains('filters-hidden');
    aplicar(oculto, true);
    if (!chico()) localStorage.setItem(CLAVE, oculto ? '1' : '0');
  }

  toggle.addEventListener('click', alternar);
  cerrar?.addEventListener('click', alternar);

  // Atajo: F para mostrar/ocultar, Escape para cerrar.
  document.addEventListener('keydown', (e) => {
    const escribiendo = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')
      || document.activeElement?.isContentEditable;
    if (escribiendo || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); alternar(); }
    else if (e.key === 'Escape' && !ticketera.classList.contains('filters-hidden')) alternar();
  });

  // Al pasar de mobile a escritorio se recupera la preferencia guardada.
  let eraChico = chico();
  window.addEventListener('resize', () => {
    const ahoraChico = chico();
    if (ahoraChico === eraChico) return;
    eraChico = ahoraChico;
    aplicar(ahoraChico ? true : localStorage.getItem(CLAVE) === '1', false);
  });
})();

// Filtros que se aplican solos. Los <select> ya envian con onchange; aca se
// cubren los campos de texto, con debounce para no recargar en cada tecla.
(function () {
  const form = document.getElementById('filter-form');
  if (!form) return;

  const estado = document.getElementById('filter-status');
  const campos = form.querySelectorAll('[data-autofiltro]');
  if (!campos.length) return;

  const RETARDO = 500;
  let timer;

  // Al recargar, devuelve el foco al campo que se estaba tipeando y deja el
  // cursor al final; si no, cada recarga interrumpiria la escritura.
  const CLAVE_FOCO = 'filtro-foco';
  try {
    const guardado = sessionStorage.getItem(CLAVE_FOCO);
    if (guardado) {
      sessionStorage.removeItem(CLAVE_FOCO);
      const el = form.querySelector(`[name="${guardado}"]`);
      if (el) {
        el.focus();
        const v = el.value;
        el.setSelectionRange(v.length, v.length);
      }
    }
  } catch (e) { /* sessionStorage bloqueado: no es critico */ }

  function enviar(campo) {
    try { sessionStorage.setItem(CLAVE_FOCO, campo.name); } catch (e) { /* idem */ }
    estado?.classList.add('is-busy');
    form.submit();
  }

  campos.forEach(campo => {
    const inicial = campo.value;
    campo.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // Si volvio al valor con el que se cargo la pagina, no recarga al pedo.
        if (campo.value.trim() === inicial.trim()) return;
        enviar(campo);
      }, RETARDO);
    });
    // Enter aplica sin esperar el debounce.
    campo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(timer);
      if (campo.value.trim() !== inicial.trim()) enviar(campo);
    });
  });

  // Los select tambien muestran el indicador de "aplicando".
  form.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', () => estado?.classList.add('is-busy'));
  });
})();
