// Replace symlinks in .next/node_modules/ with real copies
// so electron-builder packages them correctly
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.next', 'node_modules');
if (!fs.existsSync(dir)) { console.log('No .next/node_modules to fix'); process.exit(0); }

const entries = fs.readdirSync(dir);
for (const entry of entries) {
  const p = path.join(dir, entry);
  if (fs.lstatSync(p).isSymbolicLink()) {
    const target = fs.realpathSync(p);
    console.log(`Resolving symlink: ${entry} -> ${target}`);
    fs.unlinkSync(p);
    fs.cpSync(target, p, { recursive: true });
  }
}
console.log('Symlinks resolved.');
