#!/usr/bin/env node
// Build do site (PWA) para o Cloudflare Pages: `npm run build` → pasta dist/ estática.
// O app não tem bundler: o build só copia os arquivos publicados e grava dist/src/env.js com as variáveis:
//   NEXT_PUBLIC_SUPABASE_URL       https://<projeto>.supabase.co
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  chave anon/publishable (a service_role é recusada)
//   NEXT_PUBLIC_APP_URL            endereço oficial (padrão: https://bdo.winappdigital.com.br)
// O sw.js publicado recebe uma VERSION que inclui essas variáveis (trocar a chave atualiza os aparelhos).
// A base REAL de poços (src/data/) nunca é publicada.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DIST = process.env.BDOE_DIST ? path.resolve(process.env.BDOE_DIST) : path.join(ROOT, 'dist'); // BDOE_DIST: testes
const APP_URL_PADRAO = 'https://bdo.winappdigital.com.br';
const EXCLUDE = [/^src\/data\//];

const falha = (msg) => { console.error(`[build] ERRO: ${msg}`); process.exit(1); };
const env = (k) => String(process.env[k] || '').trim();

// ---------- variáveis ----------
const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
const supabaseAnonKey = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const appUrl = (env('NEXT_PUBLIC_APP_URL') || APP_URL_PADRAO).replace(/\/+$/, '');

if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) falha('defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY juntas.');
// a CSP do app só libera https://*.supabase.co
if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) falha(`NEXT_PUBLIC_SUPABASE_URL inválida: ${supabaseUrl} (esperado https://<projeto>.supabase.co)`);
if (supabaseAnonKey) {
  let secreta = /^sb_secret_/i.test(supabaseAnonKey);
  try { secreta ||= JSON.parse(Buffer.from(supabaseAnonKey.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch { /* chave publishable (não JWT) */ }
  if (secreta) falha('NEXT_PUBLIC_SUPABASE_ANON_KEY é a chave SECRETA (service_role). Use a chave anon/publishable.');
}
if (!/^https:\/\/[^\s/]+$/i.test(appUrl)) falha(`NEXT_PUBLIC_APP_URL inválida: ${appUrl} (esperado https://dominio, sem caminho)`);

// ---------- arquivos ----------
function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

// o sw.js do repositório precisa estar em dia com os arquivos (mesma verificação do pre-push)
const check = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'gerar-pwa.js'), '--check'], { stdio: 'inherit' });
if (check.status !== 0) falha('sw.js desatualizado — rode `npm run pwa:sw` e faça o commit.');

fs.rmSync(DIST, { recursive: true, force: true });
const arquivos = ['index.html', 'manifest.json', 'sw.js', ...walk('icons'), ...walk('src')].filter((f) => !EXCLUDE.some((re) => re.test(f)));
for (const f of arquivos) {
  const destino = path.join(DIST, f);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), destino);
}

const envJs = `// Gerado por \`npm run build\` (Cloudflare Pages) — não editar.
export const ENV = ${JSON.stringify({ supabaseUrl, supabaseAnonKey, appUrl }, null, 2)};
`;
fs.writeFileSync(path.join(DIST, 'src/env.js'), envJs);

// VERSION do service worker inclui as variáveis: mudou a configuração → aparelhos atualizam o cache
const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
const hash = crypto.createHash('sha256').update(envJs).digest('hex').slice(0, 6);
const swNovo = sw.replace(/const VERSION = '([0-9a-f]+)';/, (_, v) => `const VERSION = '${v}-${hash}';`);
if (swNovo === sw) falha('VERSION não encontrada no sw.js.');
fs.writeFileSync(path.join(DIST, 'sw.js'), swNovo);

// Cloudflare Pages: o sw.js e a página sempre revalidam (atualização do PWA); cabeçalhos de segurança
fs.writeFileSync(path.join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), geolocation=(self), microphone=()

/sw.js
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache

/src/env.js
  Cache-Control: no-cache
`);

if (fs.existsSync(path.join(DIST, 'src/data'))) falha('src/data foi copiado para dist (base real de poços).');
console.log(`[build] dist/ pronto: ${arquivos.length} arquivos · app ${appUrl} · Supabase ${supabaseUrl || '(não configurado: cada aparelho configura em Configurações › Servidor)'}`);
