const express = require('express');
const { pool } = require('../db');
const router = express.Router();

router.get('/tickets/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const { rows } = await pool.query(`
      SELECT id, case_id, subject, status, priority, owner, ticket_type
      FROM tickets
      WHERE CAST(id AS TEXT) LIKE $1 OR subject ILIKE $1 OR owner ILIKE $1 OR author ILIKE $1
      ORDER BY id DESC
      LIMIT 20
    `, [`%${q}%`]);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
