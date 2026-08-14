const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'data');
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('removed', f); }
}
require('../db'); // recreate
console.log('DB rebuilt from schema.');
