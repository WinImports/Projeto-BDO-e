#!/usr/bin/env node
// Baixa o binário do Electron (o npm desta máquina bloqueia scripts de pacotes).
// No build do site (Cloudflare Pages define CF_PAGES=1) o Electron não é usado: pula o download.
const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.CF_PAGES || process.env.BDOE_SKIP_ELECTRON) {
  console.log('[postinstall] build do site: download do Electron ignorado.');
  process.exit(0);
}
const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'node_modules', 'electron', 'install.js')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
