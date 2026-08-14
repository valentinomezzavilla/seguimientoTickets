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

// Pasos dinámicos según trámite seleccionado
const tramiteInput = document.querySelector('#child-tramite');
const pasoInput = document.querySelector('#child-paso');
if (tramiteInput && pasoInput) {
  tramiteInput.addEventListener('change', async () => {
    const tramite = tramiteInput.value.trim();
    const dl = document.querySelector('#dl-pasos');
    dl.innerHTML = '';
    pasoInput.value = '';
    if (!tramite) return;
    try {
      const r = await fetch('/admin/api/pasos?tramite=' + encodeURIComponent(tramite));
      const pasos = await r.json();
      pasos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        dl.appendChild(opt);
      });
    } catch(e) {}
  });
}
