-- 009: (a) PRIMEIRO ACESSO — quem recebeu matrícula provisória (gestor criado pelo Painel de Licenças) informa a
--      matrícula real junto com a senha nova: set_my_matricula grava em TODOS os vínculos do próprio e-mail
--      (a regra "uma matrícula por pessoa" do trigger _contract_members_consistencia continua valendo).
--      (b) BASE DE POÇOS POR CONTRATO — só o GESTOR envia (team_set_pocos) ou apaga (team_clear_pocos) a base do
--      contrato; todos do contrato baixam pelo app (my_pocos_bases / my_pocos_base) e usam offline.

-- (a) ------------------------------------------------------------------------------------------------
create or replace function public.set_my_matricula(p_matricula text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public._email_atual();
  v_mat text := nullif(upper(btrim(coalesce(p_matricula, ''))), '');
begin
  if v_email is null or v_email = '' then
    raise exception 'Entre com a sua conta para informar a matrícula.' using errcode = '42501';
  end if;
  if public._norm_matricula(v_mat) is null then
    raise exception 'Informe a matrícula funcional.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.contract_members where email = v_email) then
    raise exception 'Sua conta não está vinculada a nenhum contrato.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.contract_members o
             where public._norm_matricula(o.matricula) = public._norm_matricula(v_mat) and o.email <> v_email) then
    raise exception 'Matrícula % já está cadastrada para outra pessoa.', v_mat using errcode = '23505';
  end if;
  -- em dois passos: o trigger compara com os OUTROS vínculos da mesma pessoa, que ainda teriam a matrícula antiga
  update public.contract_members set matricula = null where email = v_email;
  update public.contract_members set matricula = v_mat where email = v_email;
  return v_mat;
end;
$$;

revoke all on function public.set_my_matricula(text) from public, anon;
grant execute on function public.set_my_matricula(text) to authenticated;

-- (b) ------------------------------------------------------------------------------------------------
create table if not exists public.contract_pocos (
  contrato_id   uuid primary key references public.contracts(id) on delete cascade,
  fonte         text,
  total         integer not null default 0,
  pocos         jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.contract_pocos enable row level security; -- sem políticas: só pelas funções abaixo

create or replace function public.team_set_pocos(p_contrato_id uuid, p_fonte text, p_pocos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  r public.contract_pocos;
begin
  if not public._pode_gerir(p_contrato_id) then
    raise exception 'Só o gestor do contrato envia a base de poços.' using errcode = '42501';
  end if;
  if p_pocos is null or jsonb_typeof(p_pocos) <> 'array' then
    raise exception 'Base de poços inválida.' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_pocos);
  if v_total = 0 then raise exception 'A base está vazia.' using errcode = '22023'; end if;
  if v_total > 200000 then raise exception 'Base grande demais (máximo de 200.000 poços).' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_pocos) e
             where jsonb_typeof(e) <> 'array' or jsonb_array_length(e) < 3
               or jsonb_typeof(e->0) <> 'string' or jsonb_typeof(e->1) <> 'number' or jsonb_typeof(e->2) <> 'number') then
    raise exception 'Base de poços inválida: cada poço precisa de nome, latitude e longitude.' using errcode = '22023';
  end if;
  insert into public.contract_pocos (contrato_id, fonte, total, pocos, atualizado_em, atualizado_por)
  values (p_contrato_id, left(btrim(coalesce(p_fonte, '')), 200), v_total, p_pocos, now(), public._email_atual())
  on conflict (contrato_id) do update
    set fonte = excluded.fonte, total = excluded.total, pocos = excluded.pocos,
        atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por
  returning * into r;
  return jsonb_build_object('contrato_id', r.contrato_id, 'fonte', r.fonte, 'total', r.total, 'atualizado_em', r.atualizado_em);
end;
$$;

create or replace function public.team_clear_pocos(p_contrato_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._pode_gerir(p_contrato_id) then
    raise exception 'Só o gestor do contrato apaga a base de poços.' using errcode = '42501';
  end if;
  -- "apagar" = esvaziar (total 0): os aparelhos da equipe removem a base no próximo sincronismo
  update public.contract_pocos set pocos = '[]'::jsonb, total = 0, fonte = null, atualizado_em = now(),
         atualizado_por = public._email_atual()
   where contrato_id = p_contrato_id;
end;
$$;

-- Resumo (sem os poços) das bases dos contratos do usuário: o app compara atualizado_em antes de baixar
create or replace function public.my_pocos_bases()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'contrato_id', p.contrato_id, 'contrato', c.nome, 'fonte', p.fonte, 'total', p.total, 'atualizado_em', p.atualizado_em
    ) order by p.atualizado_em desc), '[]'::jsonb)
  from public.contract_pocos p
  join public.contracts c on c.id = p.contrato_id
  where p.total > 0 and p.contrato_id in (select v.contrato_id from public._meus_vinculos() v);
$$;

create or replace function public.my_pocos_base(p_contrato_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  r public.contract_pocos;
begin
  if not exists (select 1 from public._meus_vinculos() v where v.contrato_id = p_contrato_id) then
    raise exception 'Sem acesso à base de poços deste contrato.' using errcode = '42501';
  end if;
  select * into r from public.contract_pocos where contrato_id = p_contrato_id and total > 0;
  if not found then return null; end if;
  return jsonb_build_object('contrato_id', r.contrato_id, 'fonte', r.fonte, 'total', r.total,
                            'atualizado_em', r.atualizado_em, 'pocos', r.pocos);
end;
$$;

revoke all on function public.team_set_pocos(uuid, text, jsonb) from public, anon;
grant execute on function public.team_set_pocos(uuid, text, jsonb) to authenticated;
revoke all on function public.team_clear_pocos(uuid) from public, anon;
grant execute on function public.team_clear_pocos(uuid) to authenticated;
revoke all on function public.my_pocos_bases() from public, anon;
grant execute on function public.my_pocos_bases() to authenticated;
revoke all on function public.my_pocos_base(uuid) from public, anon;
grant execute on function public.my_pocos_base(uuid) to authenticated;
