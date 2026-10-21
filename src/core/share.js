// Envio do relatório: cópias PDF e Word (.docx) no Storage (link público) + mensagem no WhatsApp.
// O link só é gerado com o Supabase configurado e com internet; sem isso, a mensagem vai sem link
// (o relatório continua na Caixa de Saída e é enviado ao banco quando houver conexão).

import { SYNC, isSupabaseConfigured } from '../config.js';
import { getClient } from './supabase.js';
import { getSettings } from './settings.js';
import { sanitizarWhatsApp } from './telefone.js';

const brData = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : '');

export const waNumber = sanitizarWhatsApp;

/** Link oficial: abre a conversa direto no app (sem número → o WhatsApp pede para escolher o contato). */
export function waUrl(numero, texto) {
  const n = sanitizarWhatsApp(numero);
  return `https://api.whatsapp.com/send?${n ? `phone=${n}&` : ''}text=${encodeURIComponent(texto)}`;
}

export function shareMessage(module, data, uniqueId, link, wordLink = null) {
  const linhas = [
    `*${module.title}*`,
    data.poco ? `Poço / Locação: ${data.poco}` : '',
    brData(data.data || data.data_hora) ? `Data: ${brData(data.data || data.data_hora)}` : '',
    `ID: ${uniqueId.slice(0, 8)}`,
    '',
    link ? `Relatório completo (PDF): ${link}` : 'Relatório salvo no aparelho; o envio ao banco de dados é feito automaticamente quando houver conexão.',
    link && wordLink ? `Versão Word (.docx): ${wordLink}` : ''
  ];
  return linhas.filter((l, i) => l || i === 4).join('\n');
}

/**
 * Sobe uma cópia do relatório (PDF ou Word .docx) para o bucket público de links.
 * Caminho fixo pelo uniqueId (não adivinhável) → reenviar não duplica. Devolve a URL pública ou null.
 */
export async function uploadShareCopy(module, uniqueId, file) {
  if (!isSupabaseConfigured() || !navigator.onLine) return null;
  const client = getClient();
  const path = `${module.id}/${uniqueId}.${file.ext}`;
  const { error } = await client.storage.from(SYNC.shareBucket)
    .upload(path, file.blob, { contentType: file.blob.type, upsert: false });
  if (error && !/already exists|duplicate|409/i.test(`${error.message} ${error.statusCode}`)) throw error;
  return client.storage.from(SYNC.shareBucket).getPublicUrl(path).data.publicUrl;
}

export const whatsappConfigurado = () => Boolean(waNumber(getSettings().whatsapp_padrao));

// Cópias PDF + Word por relatório: o envio (sync) e o WhatsApp pedem os mesmos arquivos ao mesmo tempo —
// a geração e o upload acontecem uma vez só por uniqueId (se falhar, a próxima chamada tenta de novo).
const publicando = new Map();

/**
 * Gera (makeFiles → [{ blob, ext }]) e sobe as cópias do relatório para o report-share, nos caminhos
 * fixos <módulo>/<uniqueId>.pdf e .docx. Devolve { pdf, docx } com as URLs públicas (null sem servidor/internet).
 */
export function publishReportDocuments(module, uniqueId, makeFiles) {
  if (!isSupabaseConfigured() || !navigator.onLine) return Promise.resolve(null);
  if (!publicando.has(uniqueId)) {
    const job = (async () => {
      const urls = {};
      for (const file of await makeFiles()) urls[file.ext] = await uploadShareCopy(module, uniqueId, file);
      return urls;
    })();
    publicando.set(uniqueId, job);
    job.catch(() => publicando.delete(uniqueId));
  }
  return publicando.get(uniqueId);
}
