const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const src = path.join(repoRoot, 'front-user', 'dist');
const dest = path.join(__dirname, '..', 'front-user-dist');

if (!fs.existsSync(src)) {
  console.error('front-user/dist not found. Run: cd front-user && npm run build');
  process.exit(1);
}
if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Copied front-user/dist -> desktop/front-user-dist');
