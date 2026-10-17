// Identificadores e hash de conteúdo.
// uniqueId: UUID gerado quando o relatório é criado e mantido em todas as tentativas de envio.
// É a chave de idempotência — o banco ignora um segundo envio com o mesmo uniqueId.

export const newUniqueId = () => crypto.randomUUID();

// JSON com chaves ordenadas, para o hash não depender da ordem dos campos
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
