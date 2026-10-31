// Base de poços DA EQUIPE (migração 009): só o GESTOR do contrato importa ou limpa a base (Configurações); ao
// importar, ela também vai para o servidor (team_set_pocos) e todos do contrato recebem no próximo
// sincronismo (my_pocos_bases → my_pocos_base), guardada no aparelho para usar sem internet.
// Sem conta no servidor (modo "Somente local" / usuário local) não há equipe: a base continua por aparelho.
import * as platform from './platform.js';
import { invalidatePocos } from './pocos.js';
import { contratosGeridos, souGestor } from './contratos.js';
import { currentUser } from './auth.js';
import { isSupabaseConfigured } from '../config.js';

const listeners = new Set();
export const onBaseEquipeChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const avisar = () => listeners.forEach((fn) => fn());

/** Entrou com conta do servidor (não é usuário local deste aparelho). */
export const contaNoServidor = () => isSupabaseConfigured() && Boolean(currentUser()) && currentUser().modo !== 'local';

/** Importar / limpar a base: só o gestor (ou quem usa o app sem servidor). */
export const podeGerirBase = () => !contaNoServidor() || souGestor();

const semMigracao = (e) => /PGRST202|my_pocos_base|team_set_pocos|team_clear_pocos/i.test(`${e?.code} ${e?.message}`);

async function guardar(base, contrato) {
  const r = await platform.setPocosEquipe({
    fonte: base.fonte || null, importadoEm: base.atualizado_em || null, pocos: base.pocos,
    equipe: { contratoId: base.contrato_id, contrato: contrato || '', atualizadoEm: base.atualizado_em || null }
  });
  if (r && r.ok === false) throw new Error(r.error || 'Não foi possível guardar a base da equipe.');
  invalidatePocos();
  avisar();
}

/**
 * Baixa a base mais recente dos contratos do usuário, se for diferente da guardada. Sem base no servidor e com a
 * base da equipe no aparelho (o gestor apagou): remove. Retorna 'atualizada' | 'removida' | null.
 */
export async function atualizarBaseEquipe(client) {
  if (!client || !contaNoServidor()) return null;
  const { data, error } = await client.rpc('my_pocos_bases');
  if (error) { if (semMigracao(error)) return null; throw error; }
  const lista = Array.isArray(data) ? data : [];
  const local = await platform.pocosStatus();
  if (!lista.length) {
    if (local?.origem !== 'equipe') return null;
    await platform.clearPocos();
    invalidatePocos();
    avisar();
    return 'removida';
  }
  const alvo = lista[0]; // a mais recente
  if (local?.origem === 'equipe' && local.equipe?.contratoId === alvo.contrato_id && local.equipe?.atualizadoEm === alvo.atualizado_em) return null;
  const r = await client.rpc('my_pocos_base', { p_contrato_id: alvo.contrato_id });
  if (r.error) throw r.error;
  if (!r.data?.pocos?.length) return null;
  await guardar(r.data, alvo.contrato);
  return 'atualizada';
}

/** Gestor: envia a base deste aparelho para todos os contratos que ele gere. Retorna os nomes dos contratos. */
export async function enviarBaseEquipe(client) {
  const geridos = contratosGeridos();
  if (!geridos.length) throw new Error('Só o gestor do contrato envia a base para a equipe.');
  const base = await platform.getPocos();
  if (!base?.pocos?.length) throw new Error('Não há base neste aparelho para enviar.');
  let ultimo = null;
  for (const c of geridos) {
    const { data, error } = await client.rpc('team_set_pocos', { p_contrato_id: c.id, p_fonte: base.fonte || '', p_pocos: base.pocos });
    if (error) throw new Error(semMigracao(error) ? 'O servidor ainda não aceita a base da equipe (migração 009).' : (error.message || 'Falha ao enviar a base.'));
    ultimo = { ...data, contrato: c.nome };
  }
  // a cópia deste aparelho passa a ser a da equipe (não baixa de novo no próximo sincronismo)
  await guardar({ ...ultimo, fonte: base.fonte, pocos: base.pocos }, ultimo.contrato);
  return geridos.map((c) => c.nome);
}

/** Gestor: apaga a base da equipe no servidor (todos do contrato deixam de receber). */
export async function apagarBaseEquipe(client) {
  for (const c of contratosGeridos()) {
    const { error } = await client.rpc('team_clear_pocos', { p_contrato_id: c.id });
    if (error && !semMigracao(error)) throw new Error(error.message || 'Falha ao apagar a base da equipe.');
  }
}
