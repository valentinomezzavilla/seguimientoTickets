const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Iniciar sesión', layout: false, error: null });
});

router.post('/login', async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();
    if (!username || !password) return res.render('login', { title: 'Iniciar sesión', layout: false, error: 'Completá usuario y contraseña' });

    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 AND active=true', [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { title: 'Iniciar sesión', layout: false, error: 'Usuario o contraseña incorrectos' });
    }

    req.session.user = { id: user.id, username: user.username, fullname: user.fullname, role: user.role };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('login', { title: 'Iniciar sesión', layout: false, error: 'Error interno' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
