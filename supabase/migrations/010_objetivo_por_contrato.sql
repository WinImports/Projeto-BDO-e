-- 010: OBJETIVO dos relatórios por contrato — o gestor define em Ajustes o objetivo do Relatório de Visita Técnica
-- e o do Relatório de Execução (team_set_objetivos); todos do contrato recebem junto com a empresa
-- (my_contract_companies) e os relatórios saem com o objetivo do contrato escolhido. Vazio = texto padrão do app.
alter table public.contracts add column if not exists objetivo_visita text;
alter table public.contracts add column if not exists objetivo_execucao text;

create or replace function public.team_set_objetivos(p_contrato_id uuid, p_visita text, p_execucao text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts;
begin
  if not public._pode_gerir(p_contrato_id) then
    raise exception 'Só o gestor do contrato altera os objetivos dos relatórios.' using errcode = '42501';
  end if;
  update public.contracts
     set objetivo_visita = nullif(left(btrim(coalesce(p_visita, '')), 2000), ''),
         objetivo_execucao = nullif(left(btrim(coalesce(p_execucao, '')), 2000), '')
   where id = p_contrato_id
  returning * into c;
  if not found then raise exception 'Contrato não encontrado.' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', c.id, 'nome', c.nome,
    'objetivo_visita', coalesce(c.objetivo_visita, ''), 'objetivo_execucao', coalesce(c.objetivo_execucao, ''));
end;
$$;

-- mesma função da migração 003, agora também com os objetivos do contrato
create or replace function public.my_contract_companies()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome,
      'empresa_nome', coalesce(c.empresa_nome, ''), 'empresa_cnpj', coalesce(c.empresa_cnpj, ''),
      'empresa_logo', coalesce(c.empresa_logo, ''), 'atualizada_em', c.empresa_atualizada_em,
      'objetivo_visita', coalesce(c.objetivo_visita, ''), 'objetivo_execucao', coalesce(c.objetivo_execucao, '')
    ) order by c.nome), '[]'::jsonb)
  from public.contracts c
  where c.id in (select v.contrato_id from public._meus_vinculos() v);
$$;

revoke all on function public.team_set_objetivos(uuid, text, text) from public, anon;
grant execute on function public.team_set_objetivos(uuid, text, text) to authenticated;
revoke all on function public.my_contract_companies() from public, anon;
grant execute on function public.my_contract_companies() to authenticated;
