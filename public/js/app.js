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
