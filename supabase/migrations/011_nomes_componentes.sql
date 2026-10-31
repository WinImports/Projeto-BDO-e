-- 011: NOMES das válvulas e flanges por contrato — o gestor renomeia em Ajustes (team_set_nomes); todos do contrato
-- recebem junto com a empresa (my_contract_companies) e os relatórios saem com esses nomes. {} = nomes do app.
alter table public.contracts add column if not exists nomes_componentes jsonb not null default '{}'::jsonb;

create or replace function public.team_set_nomes(p_contrato_id uuid, p_nomes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts;
  v jsonb := coalesce(p_nomes, '{}'::jsonb);
begin
  if not public._pode_gerir(p_contrato_id) then
    raise exception 'Só o gestor do contrato altera os nomes das válvulas e flanges.' using errcode = '42501';
  end if;
  if jsonb_typeof(v) <> 'object' or length(v::text) > 8000 then
    raise exception 'Lista de nomes inválida.' using errcode = '22023';
  end if;
  update public.contracts set nomes_componentes = v where id = p_contrato_id returning * into c;
  if not found then raise exception 'Contrato não encontrado.' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', c.id, 'nome', c.nome, 'nomes_componentes', c.nomes_componentes);
end;
$$;

-- mesma função da migração 010, agora também com os nomes das válvulas e flanges
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
      'objetivo_visita', coalesce(c.objetivo_visita, ''), 'objetivo_execucao', coalesce(c.objetivo_execucao, ''),
      'nomes_componentes', coalesce(c.nomes_componentes, '{}'::jsonb)
    ) order by c.nome), '[]'::jsonb)
  from public.contracts c
  where c.id in (select v.contrato_id from public._meus_vinculos() v);
$$;

revoke all on function public.team_set_nomes(uuid, jsonb) from public, anon;
grant execute on function public.team_set_nomes(uuid, jsonb) to authenticated;
revoke all on function public.my_contract_companies() from public, anon;
grant execute on function public.my_contract_companies() to authenticated;
