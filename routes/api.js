const express = require('express');
const db = require('../db');
const router = express.Router();

// Búsqueda rápida de tickets (para asociación desde el detalle de un caso)
router.get('/tickets/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = db.prepare(`
    SELECT id, case_id, subject, status, priority, owner, ticket_type
    FROM tickets
    WHERE CAST(id AS TEXT) LIKE @q OR subject LIKE @q OR owner LIKE @q OR author LIKE @q
    ORDER BY id DESC
    LIMIT 20
  `).all({ q: `%${q}%` });
  res.json(rows);
});

module.exports = router;
