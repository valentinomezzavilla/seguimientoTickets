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
