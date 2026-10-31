// Ponte entre o app e a plataforma: Electron (desktop) ou navegador/PWA (celular, GitHub Pages).
// No desktop tudo passa pelo preload (window.desktop). No navegador:
//   - base de poços: importada pelo usuário (localStorage) → arquivo publicado src/data/pocos-ba.json → vazia
//   - importação: mesmo parser do desktop (src/shared/pocos-parser.js → window.PocosParser)

export const isDesktop = () => Boolean(window.desktop?.isElectron);

const WEB_BASE_KEY = 'bdoe.pocosBase';
const EMPTY = { origem: null, fonte: null, importadoEm: null, total: 0, pocos: [] };

function readWebImported() {
  try { return JSON.parse(localStorage.getItem(WEB_BASE_KEY)); } catch { return null; }
}

let bundledPromise = null;
function webBundled() {
  // A base real não é publicada no GitHub; se o arquivo não existir, segue sem base
  bundledPromise ||= fetch('./src/data/pocos-ba.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return bundledPromise;
}

export async function getPocos() {
  if (isDesktop()) return window.desktop.getPocos();
  const imported = readWebImported();
  if (imported?.pocos?.length) return { ...imported, origem: imported.equipe ? 'equipe' : 'importada', total: imported.pocos.length };
  const bundled = await webBundled();
  if (bundled?.pocos?.length) return { ...bundled, origem: 'embutida', importadoEm: bundled.geradoEm || null, total: bundled.pocos.length };
  return EMPTY;
}

const statusOf = (b) => ({ origem: b.origem, fonte: b.fonte, importadoEm: b.importadoEm, total: b.total, equipe: b.equipe || null });

export async function pocosStatus() {
  if (isDesktop()) return window.desktop.pocosStatus();
  return statusOf(await getPocos());
}

/** @param {Uint8Array} bytes conteúdo do .csv/.kml */
export async function importPocos(name, bytes) {
  if (isDesktop()) return window.desktop.importPocos(name, bytes);
  const parser = window.PocosParser;
  if (!parser) return { ok: false, error: 'Leitor de arquivos não carregado. Recarregue a página.' };
  let r;
  try {
    r = parser.parseFile(bytes, name);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const error = parser.importError(r);
  if (error) return { ok: false, error, problems: r.problems.slice(0, 20), problemsCount: r.problems.length };
  const base = { fonte: name, importadoEm: new Date().toISOString(), formato: r.formato, total: r.pocos.length, pocos: r.pocos };
  try {
    localStorage.setItem(WEB_BASE_KEY, JSON.stringify(base));
  } catch {
    return { ok: false, error: 'Sem espaço no navegador para guardar a base. Libere espaço e tente de novo.' };
  }
  return {
    ok: true, ...statusOf({ ...base, origem: 'importada' }), formato: r.formato, lidos: r.lidos,
    foraDaRegiao: r.foraDaRegiao, problems: r.problems.slice(0, 50), problemsCount: r.problems.length
  };
}

/**
 * Base recebida da equipe (o gestor envia pelo servidor, migração 009): substitui a base deste aparelho.
 * base = { fonte, importadoEm, pocos: [[nome, lat, lng], …], equipe: { contratoId, contrato, atualizadoEm } }
 */
export async function setPocosEquipe(base) {
  if (isDesktop()) return window.desktop.setPocos(base);
  const salvo = { fonte: base.fonte || null, importadoEm: base.importadoEm || null, total: base.pocos.length, pocos: base.pocos, equipe: base.equipe };
  try {
    localStorage.setItem(WEB_BASE_KEY, JSON.stringify(salvo));
  } catch {
    return { ok: false, error: 'Sem espaço no navegador para guardar a base da equipe.' };
  }
  return { ok: true, ...statusOf({ ...salvo, origem: 'equipe' }) };
}

export async function clearPocos() {
  if (isDesktop()) return window.desktop.clearPocos();
  try { localStorage.removeItem(WEB_BASE_KEY); } catch { /* ignora */ }
  return pocosStatus();
}
