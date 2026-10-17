// IPC da base de poços/locações.
// Prioridade: base IMPORTADA pelo usuário (userData/pocos-base.json) → base EMBUTIDA no app
// (src/data/pocos-ba.json, ou BDOE_POCOS_FILE nos testes) → vazia.
const path = require('path');
const fs = require('fs/promises');
const { parseFile, importError } = require('../src/shared/pocos-parser');

const MAX_BYTES = 50 * 1024 * 1024;
const EMPTY = { origem: null, fonte: null, importadoEm: null, total: 0, pocos: [] };

function registerPocosIpc(ipcMain, app) {
  const importedFile = () => path.join(app.getPath('userData'), 'pocos-base.json');
  const bundledFile = () => process.env.BDOE_POCOS_FILE || path.join(__dirname, '..', 'src', 'data', 'pocos-ba.json');
  let cache = null;

  async function readJson(file) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
  }

  async function load() {
    if (cache) return cache;
    const imported = await readJson(importedFile());
    if (imported?.pocos?.length) {
      cache = { ...imported, origem: 'importada', total: imported.pocos.length };
    } else {
      const bundled = await readJson(bundledFile());
      cache = bundled?.pocos?.length
        ? { ...bundled, origem: 'embutida', importadoEm: bundled.geradoEm || null, total: bundled.pocos.length }
        : EMPTY;
    }
    return cache;
  }

  const status = (b) => ({ origem: b.origem, fonte: b.fonte, importadoEm: b.importadoEm, total: b.total });

  ipcMain.handle('pocos:list', () => load());
  ipcMain.handle('pocos:status', async () => status(await load()));

  // Recebe o conteúdo do arquivo escolhido/arrastado na tela de Configurações
  ipcMain.handle('pocos:import', async (_e, { name, bytes }) => {
    if (!bytes || !bytes.byteLength) return { ok: false, error: 'Arquivo vazio.' };
    if (bytes.byteLength > MAX_BYTES) return { ok: false, error: 'Arquivo maior que 50 MB.' };
    let r;
    try {
      r = parseFile(new Uint8Array(bytes), name);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const error = importError(r);
    if (error) return { ok: false, error, problems: r.problems.slice(0, 20), problemsCount: r.problems.length };
    const base = { fonte: path.basename(name || 'arquivo'), importadoEm: new Date().toISOString(), formato: r.formato, total: r.pocos.length, pocos: r.pocos };
    const file = importedFile();
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(base)); // grava e troca de uma vez: sem base corrompida se cair a energia
    await fs.rename(tmp, file);
    cache = { ...base, origem: 'importada' };
    return {
      ok: true, ...status(cache), formato: r.formato, lidos: r.lidos,
      foraDaRegiao: r.foraDaRegiao, problems: r.problems.slice(0, 50), problemsCount: r.problems.length
    };
  });

  ipcMain.handle('pocos:clear', async () => {
    await fs.rm(importedFile(), { force: true });
    cache = null;
    return status(await load()); // volta para a base embutida (se houver) ou vazia
  });
}

module.exports = { registerPocosIpc };
