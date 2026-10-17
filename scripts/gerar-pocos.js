#!/usr/bin/env node
// Gera a base de poços EMBUTIDA no app (src/data/pocos-ba.json) a partir de um CSV ou KML.
// Na operação normal, a base é importada pela tela Configurações → "Base de Poços e Locações";
// este script serve para distribuir o app já com uma base padrão.
//
// Uso:  npm run pocos                        (lê ./pocos_UO-BA_verificacao.csv)
//       npm run pocos -- caminho/arquivo.kml

const fs = require('fs');
const path = require('path');
const { parseFile } = require('../src/shared/pocos-parser');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SRC = path.join(ROOT, 'pocos_UO-BA_verificacao.csv');
const OUT = path.join(ROOT, 'src', 'data', 'pocos-ba.json');

function main() {
  const src = path.resolve(process.argv[2] || DEFAULT_SRC);
  if (!fs.existsSync(src)) {
    console.error(`Arquivo não encontrado: ${src}\nInforme o caminho: npm run pocos -- caminho/arquivo.csv`);
    process.exit(1);
  }
  let r;
  try {
    r = parseFile(fs.readFileSync(src), src);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const out = { fonte: path.basename(src), geradoEm: new Date().toISOString(), total: r.pocos.length, pocos: r.pocos };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  console.log(`Origem: ${src} (${r.formato})`);
  console.log(`Registros lidos: ${r.lidos} · Poços gravados: ${r.pocos.length} · ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
  if (r.foraDaRegiao) console.warn(`Atenção: ${r.foraDaRegiao} poço(s) fora da região BA/SE — confira o arquivo.`);
  if (r.problems.length) {
    console.warn(`${r.problems.length} registro(s) ignorado(s) ou com aviso:`);
    r.problems.slice(0, 30).forEach((p) => console.warn(`  - ${p}`));
    if (r.problems.length > 30) console.warn(`  ... e mais ${r.problems.length - 30}`);
  }
}

main();
