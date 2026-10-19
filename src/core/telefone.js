// Número de WhatsApp no formato internacional (só dígitos, com o código do país 55 do Brasil).

/**
 * "(71) 99961-2118" | "71999612118" | "+55 71 99961-2118" | "071 99961-2118" → "5571999612118".
 * Vazio ou curto demais → ''.
 */
export function sanitizarWhatsApp(raw) {
  let d = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d; // já com o país
  if (d.length === 10 || d.length === 11) d = `55${d}`; // DDD + número
  return d.length >= 12 ? d : '';
}
