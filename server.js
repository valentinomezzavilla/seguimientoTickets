const path = require('path');
const express = require('express');
const morgan = require('morgan');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const { requireLogin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'mesa-servicios-2026-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
}));

// Helpers de vista
app.locals.fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d)) return s;
  return d.toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
};
app.locals.fmtShort = (s) => {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d)) return s;
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'2-digit' });
};
app.locals.stClass = (s) => {
  const t = (s || '').toLowerCase();
  if (t.includes('cerrad') || t.includes('resuelt')) return 'st-cerrada';
  if (t.includes('progreso')) return 'st-progreso';
  if (t.includes('asignada') || t.includes('abierta')) return 'st-asignada';
  if (t.includes('pendient')) return 'st-pendiente';
  if (t.includes('verificar')) return 'st-verificar';
  if (t.includes('seguimient')) return 'st-seguimiento';
  if (t.includes('nuev')) return 'st-nuevo';
  return 'st-default';
};
app.locals.prClass = (p) => {
  const t = (p || '').toLowerCase();
  if (t.includes('inmediat')) return 'pr-inmediata';
  if (t.includes('muy alta')) return 'pr-muyalta';
  if (t.includes('alta')) return 'pr-alta';
  if (t.includes('media')) return 'pr-media';
  if (t.includes('baja')) return 'pr-baja';
  return '';
};

// Rutas públicas
app.use('/', require('./routes/auth'));

// Todo lo demás requiere login
app.use(requireLogin);

app.get('/', (req, res) => res.redirect('/casos'));
app.use('/casos', require('./routes/cases'));
app.use('/tickets', require('./routes/tickets'));
app.use('/api', require('./routes/api'));
app.use('/admin', require('./routes/admin'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message, stack: err.stack, filters: {} });
});

app.listen(PORT, () => console.log(`Escuchando en http://localhost:${PORT}`));
