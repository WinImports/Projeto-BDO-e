// Parser da base de poços/locações (CSV ou KML) → [[nome, lat, lng], ...]
// Compartilhado: processo principal do Electron, navegador/PWA (<script>, window.PocosParser),
// scripts/gerar-pocos.js e os testes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PocosParser = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
//
// CSV: separador ; , ou TAB · UTF-8 ou Latin-1 (Excel) · decimal com vírgula ou ponto ·
//      coordenadas decimais (-12.3524) ou em graus/minutos/segundos (12°21'08.6"S).
// KML: <Placemark> com <name> (ou ExtendedData com o nome do poço) e <Point>; polígonos/linhas
//      usam o ponto central dos vértices.

// Colunas reconhecidas pelo cabeçalho (sem acento, minúsculas)
const COLS = {
  nome: /^(poco|pocos|nome|nome_poco|nome do poco|codigo|cod|locacao|poco\/locacao|well|identificacao|sigla)\b/,
  lat: /^(lat|latitude)\b/,
  lng: /^(lon|long|lng|longitude)\b/
};

// Limites aproximados da Bahia/Sergipe para alertar coordenadas suspeitas
const REGIAO = { latMin: -18.5, latMax: -9.0, lngMin: -46.7, lngMax: -36.8 };

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Bytes (Uint8Array/ArrayBuffer/Buffer) → texto (UTF-8 com/sem BOM ou Latin-1). */
function decode(buf) {
  if (typeof buf === 'string') return buf;
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  const utf8 = new TextDecoder('utf-8').decode(b);
  return utf8.includes('�') ? new TextDecoder('latin1').decode(b) : utf8; // CSV salvo pelo Excel costuma ser Latin-1
}

function detectDelimiter(headerLine) {
  const counts = [';', ',', '\t'].map((d) => [d, headerLine.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** Divide o CSV respeitando aspas ("a;b" fica numa célula só). */
function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true; // aspas só abrem no início da célula (12°21'08.6"S é valor)
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** "-12,3524" | "-12.3524" | "12°21'08.6\"S" | "12 21 08.6 S" → número (ou NaN). */
function parseCoord(raw) {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  if (/^[-+]?\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  const m = s.replace(',', '.').match(/^([-+])?\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)?\D*(\d+(?:\.\d+)?)?\D*?([NSEWLO])?\s*$/i);
  if (!m) return NaN;
  const [, sign, d, mi = 0, se = 0, hemi = ''] = m;
  let v = Number(d) + Number(mi) / 60 + Number(se) / 3600;
  if (sign === '-' || /[SWO]/i.test(hemi)) v = -v;
  return v;
}

/**
 * Validação e deduplicação comuns a CSV e KML.
 * entries: [{ ref, nome, lat, lng, rawLat, rawLng }]
 */
function build(entries) {
  const seen = new Map();
  const problems = [];
  let foraDaRegiao = 0;
  for (const e of entries) {
    const nome = String(e.nome || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const { lat, lng } = e;
    if (!nome) { problems.push(`${e.ref}: sem nome do poço`); continue; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      problems.push(`${e.ref} (${nome}): coordenada inválida "${e.rawLat}", "${e.rawLng}"`);
      continue;
    }
    if (lat < REGIAO.latMin || lat > REGIAO.latMax || lng < REGIAO.lngMin || lng > REGIAO.lngMax) foraDaRegiao++;
    const item = [nome, Number(lat.toFixed(6)), Number(lng.toFixed(6))];
    if (seen.has(nome)) {
      const prev = seen.get(nome);
      if (prev[1] !== item[1] || prev[2] !== item[2]) problems.push(`${e.ref} (${nome}): duplicado com coordenadas diferentes — mantida a primeira`);
      continue;
    }
    seen.set(nome, item);
  }
  const pocos = [...seen.values()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
  return { pocos, problems, foraDaRegiao, lidos: entries.length };
}

function convertCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = detectDelimiter(firstLine);
  const [header = [], ...rows] = parseCsv(text, delim);
  const h = header.map(norm);
  const col = {
    nome: h.findIndex((c) => COLS.nome.test(c)),
    lat: h.findIndex((c) => COLS.lat.test(c)),
    lng: h.findIndex((c) => COLS.lng.test(c))
  };
  const missing = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => ({ nome: 'nome do poço', lat: 'latitude', lng: 'longitude' })[k]);
  if (missing.length) {
    throw new Error(`Não encontrei a(s) coluna(s) ${missing.join(', ')} no cabeçalho do CSV (${header.join(' | ') || 'vazio'}).`);
  }
  const entries = rows.map((r, i) => ({
    ref: `linha ${i + 2}`,
    nome: r[col.nome],
    lat: parseCoord(r[col.lat]),
    lng: parseCoord(r[col.lng]),
    rawLat: r[col.lat],
    rawLng: r[col.lng]
  }));
  return { ...build(entries), formato: 'CSV', delim, header };
}

// ---------- KML ----------

const xmlText = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&')
  .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i'));
  return m ? xmlText(m[1]) : '';
};

/** Nome do poço no ExtendedData (<Data name="POCO"><value>…) ou (<SimpleData name="POCO">…). */
function extendedName(pm) {
  const re = /<(?:\w+:)?(?:Data|SimpleData)\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:Data|SimpleData)>/gi;
  let m;
  while ((m = re.exec(pm))) {
    if (COLS.nome.test(norm(m[1]))) {
      const value = /<(?:\w+:)?value\b/i.test(m[2]) ? tag(m[2], 'value') : xmlText(m[2]);
      if (value) return value;
    }
  }
  return '';
}

function convertKml(text) {
  const placemarks = text.match(/<(?:\w+:)?Placemark\b[\s\S]*?<\/(?:\w+:)?Placemark>/gi) || [];
  if (!placemarks.length) throw new Error('O KML não tem nenhum marcador (<Placemark>).');
  const entries = placemarks.map((pm, i) => {
    const nome = tag(pm, 'name') || extendedName(pm);
    // KML usa "longitude,latitude[,altitude]" separados por espaço; alguns exportadores
    // põem espaços em volta da vírgula ("-38.43 , -12.79") — normaliza antes de separar
    const raw = tag(pm, 'coordinates').replace(/\s*,\s*/g, ',');
    const pts = raw.split(/\s+/).filter(Boolean)
      .map((t) => t.split(',').map((n) => (n.trim() === '' ? NaN : Number(n))))
      .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    let lat = NaN;
    let lng = NaN;
    if (pts.length === 1 || /<(?:\w+:)?Point\b/i.test(pm)) {
      [lng, lat] = pts[0] || [];
    } else if (pts.length > 1) {
      const ring = pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1] ? pts.slice(0, -1) : pts;
      lng = ring.reduce((s, p) => s + p[0], 0) / ring.length; // centro da locação (polígono/linha)
      lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    }
    return { ref: `marcador ${i + 1}`, nome, lat, lng, rawLat: raw.slice(0, 40), rawLng: '' };
  });
  return { ...build(entries), formato: 'KML' };
}

/**
 * Processa o arquivo pelo nome/conteúdo. Lança erro com mensagem amigável se não der.
 * @returns {{pocos, problems, foraDaRegiao, lidos, formato}}
 */
function parseFile(buffer, fileName = '') {
  const ext = String(fileName).toLowerCase().split('.').pop();
  if (ext === 'kmz') throw new Error('Arquivos .kmz são compactados. Abra no Google Earth e salve como .kml, ou exporte a planilha em .csv.');
  const text = decode(buffer);
  const looksKml = ext === 'kml' || /<kml\b/i.test(text.slice(0, 2000));
  if (looksKml) return convertKml(text);
  if (ext && ext !== 'csv' && ext !== 'txt') throw new Error(`Formato .${ext} não suportado. Use .csv ou .kml.`);
  return convertCsv(text);
}

/** Regras para aceitar uma importação. Devolve a mensagem de erro, ou null se estiver ok. */
function importError(r) {
  if (!r.pocos.length) return 'Nenhum poço válido encontrado no arquivo.';
  // Quase tudo fora da BA/SE = latitude/longitude trocadas ou outro sistema (UTM etc.)
  if (r.foraDaRegiao > r.pocos.length * 0.5) {
    return `${r.foraDaRegiao} de ${r.pocos.length} poços ficaram fora da região BA/SE. Verifique se latitude e longitude não estão trocadas ou em outro formato (ex.: UTM). A base não foi importada.`;
  }
  return null;
}

return { parseFile, convertCsv, convertKml, parseCoord, parseCsv, decode, importError, REGIAO };
});
