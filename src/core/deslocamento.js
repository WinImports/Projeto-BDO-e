// Deslocamentos na apropriação do BDO: detecta o termo ("deslocando para", "indo para", "seguindo para",
// "iniciando deslocamento", "mobilizando"...) e extrai o destino — um POÇO da base ou uma CIDADE / BASE.
import { getSettings } from './settings.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Sedes municipais da região (UO-BA / SE) — coordenadas aproximadas do centro da cidade.
// Bases e locais sem coordenada pública conhecida (ex.: Taquipe, Fazenda Imbé) são cadastrados
// pelo usuário em Configurações › Bases e locais personalizados.
export const CIDADES = [
  { nome: 'Catu', uf: 'BA', lat: -12.3536, lng: -38.3786 },
  { nome: 'São Sebastião do Passé', uf: 'BA', lat: -12.5128, lng: -38.4950, apelidos: ['São Sebastião', 'S. Sebastião'] },
  { nome: 'Pojuca', uf: 'BA', lat: -12.4303, lng: -38.3317 },
  { nome: 'Alagoinhas', uf: 'BA', lat: -12.1356, lng: -38.4192 },
  { nome: 'Mata de São João', uf: 'BA', lat: -12.5307, lng: -38.2992 },
  { nome: 'Candeias', uf: 'BA', lat: -12.6716, lng: -38.5508 },
  { nome: "Dias d'Ávila", uf: 'BA', lat: -12.6128, lng: -38.2972, apelidos: ['Dias Davila', 'Dias d Avila'] },
  { nome: 'Camaçari', uf: 'BA', lat: -12.6997, lng: -38.3243 },
  { nome: 'Simões Filho', uf: 'BA', lat: -12.7844, lng: -38.4033 },
  { nome: 'Salvador', uf: 'BA', lat: -12.9714, lng: -38.5014 },
  { nome: 'Entre Rios', uf: 'BA', lat: -11.9417, lng: -38.0844 },
  { nome: 'Esplanada', uf: 'BA', lat: -11.7961, lng: -37.9431 },
  { nome: 'Cardeal da Silva', uf: 'BA', lat: -11.9472, lng: -37.9467 },
  { nome: 'Araçás', uf: 'BA', lat: -12.2200, lng: -38.2028 },
  { nome: 'Itanagra', uf: 'BA', lat: -12.2614, lng: -38.0436 },
  { nome: 'Santo Amaro', uf: 'BA', lat: -12.5467, lng: -38.7119 },
  { nome: 'São Francisco do Conde', uf: 'BA', lat: -12.6278, lng: -38.6800 },
  { nome: 'Madre de Deus', uf: 'BA', lat: -12.7408, lng: -38.6150 },
  { nome: 'Aracaju', uf: 'SE', lat: -10.9472, lng: -37.0731 },
  { nome: 'Carmópolis', uf: 'SE', lat: -10.6481, lng: -36.9886 },
  { nome: 'Rosário do Catete', uf: 'SE', lat: -10.6961, lng: -37.0306 },
  { nome: 'Japaratuba', uf: 'SE', lat: -10.5933, lng: -36.9419 }
];

/**
 * Locais do usuário (Configurações): uma linha por local — "Nome; latitude; longitude".
 * Ex.: "Base Taquipe; -12.55; -38.40". Linhas inválidas são ignoradas.
 */
export function locaisPersonalizados(texto = getSettings().locais_personalizados) {
  return String(texto || '').split(/\r?\n/).map((l) => l.split(/[;\t]/).map((x) => x.trim())).flatMap(([nome, la, ln]) => {
    const lat = parseFloat(String(la ?? '').replace(',', '.'));
    const lng = parseFloat(String(ln ?? '').replace(',', '.'));
    return nome && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? [{ nome, lat, lng, personalizado: true }] : [];
  });
}

const GATILHO = /\b(deslocamento|deslocando|deslocar|desloca|mobilizacao|mobilizando|mobilizar|desmobilizacao|desmobilizando)\b|\b(indo|seguindo|segue|retornando|voltando)\s+(para|pra|pro|ate)\b/;

/** O texto da atividade fala de deslocamento / mobilização? */
export const isTravel = (text) => GATILHO.test(norm(text));

const VERBO = '(?:deslocamento|deslocando|deslocar|desloca|mobilizacao|mobilizando|mobilizar|desmobilizacao|desmobilizando|indo|seguindo|segue|retornando|voltando)';
const PREP = '(?:para|pra|pro|ate|ao|rumo a)';
// "para o poço X" / "até a locação X": palavra de tipo de POÇO (sai do texto); demais tipos ficam no nome
const TIPO_POCO = '(?:(poco|locacao|sonda)(?:\\s+(?:(?:de|do|da)\\s+)?|$))?';
const CIDADE_GEN = '(?:(?:cidade|municipio)\\s+(?:de\\s+)?)?';
// 1) verbo + até 3 palavras + preposição ("mobilizando equipe para FBM-182")  2) verbo direto ("deslocamento FBM-182")
const COM_PREP = new RegExp(`${VERBO}(?:\\s+\\S+){0,3}?\\s+${PREP}\\s+(?:(?:o|a|os|as)\\s+)?${TIPO_POCO}${CIDADE_GEN}(.*)$`);
const DIRETO = new RegExp(`${VERBO}\\s+${TIPO_POCO}(.*)$`);

/**
 * Destino escrito na atividade (sem resolver): { texto, tipo } — tipo: 'poco' (havia "poço"/"locação") | null.
 * Trabalha sobre o texto normalizado (sem acento, minúsculo); "texto" volta com a grafia original.
 */
export function destinoEscrito(text) {
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  const n = norm(original);
  let m = COM_PREP.exec(n);
  // sem preposição ("Deslocamento FBM-182") só vale se parecer código de poço — "Mobilização da equipe" não é destino
  if (!m) { m = DIRETO.exec(n); if (m && !/\d/.test(m[2].split(' ')[0] || '')) m = null; }
  if (!m) return null;
  let resto = m[2].split(/[,.;:()]|\s(?:e|com|pela|pelo|via|para|apos|depois|aguardando)\s/)[0].trim();
  resto = resto.split(' ').slice(0, 5).join(' ');
  if (!resto) return null;
  // mesma posição no texto original (normalizar não muda o tamanho de letras latinas comuns)
  const ini = n.lastIndexOf(resto);
  const texto = ini >= 0 && original.length === n.length ? original.slice(ini, ini + resto.length) : resto;
  return { texto, tipo: m[1] ? 'poco' : null };
}

// "Base Taquipe" casa com "Taquipe" e vice-versa
const semTipo = (s) => s.replace(/^(?:base|fazenda|faz\.?|campo|estacao|parque)\s+(?:(?:de|do|da)\s+)?/, '');

/** Cidade / base pelo início do texto (o nome mais longo vence: "São Sebastião do Passé" antes de "São Sebastião"). */
export function acharLocal(texto, extras = locaisPersonalizados()) {
  const t = norm(texto);
  const alvos = [t, semTipo(t)];
  const todos = [...extras, ...CIDADES].flatMap((c) => [c.nome, ...(c.apelidos || [])]
    .flatMap((nome) => [norm(nome), semTipo(norm(nome))].map((chave) => ({ c, chave }))));
  const hit = todos.filter(({ chave }) => chave && alvos.some((x) => x === chave || x.startsWith(`${chave} `)))
    .sort((a, b) => b.chave.length - a.chave.length)[0];
  return hit ? hit.c : null;
}

/**
 * Resolve o destino: poço da base (findPoco) ou cidade / base.
 * @returns {{ tipo: 'poco'|'cidade', nome: string, lat: number, lng: number, uf?: string } | { tipo: null, texto: string } | null}
 */
export function resolverDestino(text, { pocos, findPoco }) { // pocos = base de loadPocos()
  const d = destinoEscrito(text);
  if (!d) return null;
  if (pocos?.list?.length) { // base carregada por loadPocos(): { list: [...] }
    // tenta o texto inteiro e cada palavra com cara de poço (FBM-182, RCB 34, 7-FBM-182D-BA...)
    const candidatos = [d.texto, ...d.texto.split(' '), ...(d.texto.match(/[a-z0-9]+(?:[-\s][a-z0-9]+)+/gi) || [])];
    for (const c of candidatos) {
      const p = findPoco(pocos, c);
      if (p) return { tipo: 'poco', nome: p.nome, lat: p.lat, lng: p.lng };
    }
  }
  const local = acharLocal(d.texto);
  if (local) return { tipo: 'cidade', nome: local.nome, uf: local.uf, lat: local.lat, lng: local.lng, personalizado: local.personalizado };
  return { tipo: null, texto: d.texto };
}
