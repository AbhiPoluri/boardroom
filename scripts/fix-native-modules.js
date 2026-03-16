// electron-builder rebuilds native modules in-place for Electron's ABI.
// Next.js runs as a child process using system Node.js, so we need to rebuild
// back to the system ABI — both in project node_modules and in the dist app.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectDir = path.join(__dirname, '..');
const appDir = path.join(projectDir, 'dist', 'mac-arm64', 'Boardroom.app', 'Contents', 'Resources', 'app');

if (!fs.existsSync(appDir)) {
  console.error('No dist app found at', appDir);
  process.exit(1);
}

const nativeModules = [
  { name: 'better-sqlite3', binary: 'build/Release/better_sqlite3.node' },
  { name: 'node-pty', binary: 'build/Release/pty.node' },
];

// Step 1: Rebuild all native modules for system Node.js
console.log(`Rebuilding native modules for system Node.js (ABI ${process.versions.modules})...`);
for (const mod of nativeModules) {
  try {
    execSync(`npm rebuild ${mod.name} --build-from-source`, {
      cwd: projectDir,
      stdio: 'inherit',
    });
  } catch (err) {
    console.warn(`Warning: failed to rebuild ${mod.name}:`, err.message);
  }
}

// Step 2: Copy rebuilt binaries to dist app
for (const mod of nativeModules) {
  const srcBinary = path.join(projectDir, 'node_modules', mod.name, mod.binary);
  const dstBinary = path.join(appDir, 'node_modules', mod.name, mod.binary);
  if (fs.existsSync(srcBinary) && fs.existsSync(path.dirname(dstBinary))) {
    fs.copyFileSync(srcBinary, dstBinary);
    console.log(`Copied ${mod.name} binary to dist app.`);
  }
}

// Step 3: Ensure .next/node_modules aliases exist and have correct binaries
const nextAlias = path.join(appDir, '.next', 'node_modules');
if (!fs.existsSync(nextAlias)) fs.mkdirSync(nextAlias, { recursive: true });

// Scan chunks for hashed module references
const chunksDir = path.join(appDir, '.next', 'server', 'chunks');
if (fs.existsSync(chunksDir)) {
  const chunkFiles = fs.readdirSync(chunksDir).filter(f => f.startsWith('[root-of-the-server]') && f.endsWith('.js'));
  for (const chunkFile of chunkFiles) {
    const content = fs.readFileSync(path.join(chunksDir, chunkFile), 'utf8');
    for (const mod of nativeModules) {
      const regex = new RegExp(`${mod.name}-[a-f0-9]+`, 'g');
      const matches = [...content.matchAll(regex)];
      const hashes = [...new Set(matches.map(m => m[0]))];
      for (const hashName of hashes) {
        const aliasDir = path.join(nextAlias, hashName);
        const srcModule = path.join(projectDir, 'node_modules', mod.name);
        if (!fs.existsSync(aliasDir) && fs.existsSync(srcModule)) {
          fs.cpSync(srcModule, aliasDir, { recursive: true });
          console.log(`Created alias: ${hashName}`);
        }
        // Update binary in alias
        const srcBinary = path.join(projectDir, 'node_modules', mod.name, mod.binary);
        const aliasBinary = path.join(aliasDir, mod.binary);
        if (fs.existsSync(srcBinary) && fs.existsSync(aliasBinary)) {
          fs.copyFileSync(srcBinary, aliasBinary);
          console.log(`Updated alias binary: ${hashName}`);
        }
      }
    }
  }
}

console.log('Done.');
