#!/usr/bin/env node
// Atualiza a lista de arquivos offline e a VERSION do sw.js (bloco <precache>).
// Rode antes de publicar:  npm run pwa
// Verificação (usada nos testes):  node scripts/gerar-pwa.js --check
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SW = path.join(ROOT, 'sw.js');

// src/data/ fica de fora: a base de poços real não é publicada (é importada no celular)
const EXCLUDE = [/^src\/data\//];

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

function files() {
  const list = ['index.html', 'manifest.json', ...walk('icons'), ...walk('src')]
    .filter((f) => !EXCLUDE.some((re) => re.test(f)))
    .sort();
  return list;
}

function build() {
  const list = files();
  const hash = crypto.createHash('sha256');
  for (const f of list) {
    const buf = fs.readFileSync(path.join(ROOT, f));
    // texto: ignora CRLF x LF (mesma versão em qualquer sistema); binários (png) entram como estão
    hash.update(f).update(/\.(png|jpg|ico)$/.test(f) ? buf : buf.toString('utf8').replace(/\r\n/g, '\n'));
  }
  const version = hash.digest('hex').slice(0, 12);
  const block = `// <precache> — gerado por \`npm run pwa\`; não editar à mão
const VERSION = '${version}';
const PRECACHE = [
  './',
${list.map((f) => `  './${f}'`).join(',\n')}
];
// </precache>`;
  const sw = fs.readFileSync(SW, 'utf8');
  const next = sw.replace(/\/\/ <precache>[\s\S]*?\/\/ <\/precache>/, block);
  return { sw, next, version, count: list.length + 1 };
}

const { sw, next, version, count } = build();
if (process.argv.includes('--check')) {
  if (sw !== next) {
    console.error('sw.js desatualizado: rode `npm run pwa`.');
    process.exit(1);
  }
  console.log(`sw.js em dia (versão ${version}, ${count} arquivos).`);
} else {
  fs.writeFileSync(SW, next);
  console.log(`sw.js atualizado: versão ${version}, ${count} arquivos no cache offline.`);
}
