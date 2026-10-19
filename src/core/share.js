// Envio do relatório: link público (cópia do relatório no Storage) + mensagem no WhatsApp.
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

export function shareMessage(module, data, uniqueId, link) {
  const linhas = [
    `*${module.title}*`,
    data.poco ? `Poço / Locação: ${data.poco}` : '',
    brData(data.data || data.data_hora) ? `Data: ${brData(data.data || data.data_hora)}` : '',
    `ID: ${uniqueId.slice(0, 8)}`,
    '',
    link ? `Relatório completo: ${link}` : 'Relatório salvo no aparelho; o envio ao banco de dados é feito automaticamente quando houver conexão.'
  ];
  return linhas.filter((l, i) => l || i === 4).join('\n');
}

/**
 * Sobe a cópia do relatório (PDF no desktop / HTML no navegador) para o bucket público de links.
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
