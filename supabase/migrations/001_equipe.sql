-- =====================================================================
-- 7) Gestão de Equipe — migração 001
-- Contratos com cota de técnicos (max_technicians), papéis (master / gestor / técnico), matrícula,
-- busca ilimitada no histórico do contrato e isolamento por contrato.
-- Idempotente: pode rodar mais de uma vez. Rode inteiro no SQL Editor do projeto BDO eletronico.
-- (O mesmo texto está no fim de supabase/schema.sql — um teste confere que são iguais.)
-- =====================================================================

-- 7.1) Master (dono do sistema) --------------------------------------------------------------
-- Só por SQL: ninguém vira master pelo app. Depois de rodar, cadastre o seu e-mail:
--   insert into public.masters (email) values ('seu-email@dominio.com');
create table if not exists public.masters (
  email      text        primary key check (email = lower(btrim(email))),
  created_at timestamptz not null default now()
);
alter table public.masters enable row level security; -- sem políticas: ninguém lê pela API

-- 7.2) Contratos com cota de técnicos ----------------------------------------------------------
-- max_technicians: quantas contas de TÉCNICO ativas o contrato pode ter (gestores não contam).
create table if not exists public.contracts (
  id              uuid        primary key default gen_random_uuid(),
  nome            text        not null check (btrim(nome) <> ''),
  nome_norm       text        generated always as (public._norm_contrato(nome)) stored,
  max_technicians integer     not null default 2 check (max_technicians >= 0),
  ativo           boolean     not null default true,
  created_at      timestamptz not null default now()
);
alter table public.contracts add column if not exists max_technicians integer not null default 2;
alter table public.contracts add column if not exists ativo boolean not null default true;
create unique index if not exists contracts_nome_norm_key on public.contracts (nome_norm);
alter table public.contracts enable row level security; -- sem políticas: acesso só pelas funções abaixo

-- 7.3) Membros do contrato: papel, matrícula, nome e acesso ativo -----------------------------
alter table public.contract_members add column if not exists id          uuid        not null default gen_random_uuid();
alter table public.contract_members add column if not exists contrato_id uuid        references public.contracts (id) on delete cascade;
alter table public.contract_members add column if not exists user_id     uuid        references auth.users (id) on delete set null;
alter table public.contract_members add column if not exists nome        text;
alter table public.contract_members add column if not exists matricula   text;
alter table public.contract_members add column if not exists role        text        not null default 'tecnico';
alter table public.contract_members add column if not exists ativo       boolean     not null default true;
alter table public.contract_members add column if not exists updated_at  timestamptz not null default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contract_members_role_check') then
    alter table public.contract_members add constraint contract_members_role_check check (role in ('gestor', 'tecnico'));
  end if;
end $$;
create unique index if not exists contract_members_id_key on public.contract_members (id);
create index if not exists contract_members_contrato_idx on public.contract_members (contrato_id, role, ativo);

-- Matrícula funcional para COMPARAR: só letras e números, em maiúsculas ("T-900" = "t 900" = "T900").
-- Ela é gravada como foi digitada (aparada, em maiúsculas); a comparação usa esta forma.
create or replace function public._norm_matricula(t text)
returns text language sql immutable
set search_path = pg_catalog
as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '[^[:alnum:]]+', '', 'g')), '');
$$;
create index if not exists contract_members_matricula_idx on public.contract_members (public._norm_matricula(matricula));

-- Contratos que já existiam só como texto em contract_members viram linhas de public.contracts
insert into public.contracts (nome)
  select distinct on (public._norm_contrato(m.contrato)) btrim(m.contrato)
  from public.contract_members m
  where public._norm_contrato(m.contrato) <> ''
  order by public._norm_contrato(m.contrato), m.created_at
on conflict (nome_norm) do nothing;
update public.contract_members m set contrato_id = c.id
  from public.contracts c
  where m.contrato_id is null and c.nome_norm = public._norm_contrato(m.contrato);
update public.contract_members m set user_id = u.id
  from auth.users u
  where m.user_id is null and lower(u.email) = lower(m.email);

-- Consistência de cada linha (vale também para cadastros feitos à mão no Table Editor / SQL):
-- e-mail em minúsculas; contrato_id ↔ nome do contrato (cria o contrato se ainda não existir);
-- uma matrícula pertence a UMA pessoa (e-mail) e cada pessoa tem uma matrícula só.
create or replace function public._contract_members_consistencia()
returns trigger language plpgsql
security definer
set search_path = public
as $$
declare
  v_contrato public.contracts;
  v_mat text := public._norm_matricula(new.matricula);
begin
  new.email := lower(btrim(new.email));
  if new.email = '' then raise exception 'e-mail obrigatório'; end if;
  new.matricula := nullif(upper(btrim(coalesce(new.matricula, ''))), '');
  if new.contrato_id is null then
    if public._norm_contrato(new.contrato) = '' then raise exception 'contrato obrigatório'; end if;
    insert into public.contracts (nome) values (btrim(new.contrato)) on conflict (nome_norm) do nothing;
    select * into v_contrato from public.contracts where nome_norm = public._norm_contrato(new.contrato);
    new.contrato_id := v_contrato.id;
  else
    select * into v_contrato from public.contracts where id = new.contrato_id;
    if not found then raise exception 'contrato inexistente'; end if;
  end if;
  new.contrato := v_contrato.nome;
  if new.user_id is null then
    select u.id into new.user_id from auth.users u where lower(u.email) = new.email;
  end if;
  if v_mat is not null and exists (
    select 1 from public.contract_members o
    where public._norm_matricula(o.matricula) = v_mat and o.email <> new.email
  ) then
    raise exception 'Matrícula % já está cadastrada para outra pessoa.', new.matricula using errcode = '23505';
  end if;
  if v_mat is not null and exists (
    select 1 from public.contract_members o
    where o.email = new.email and o.matricula is not null and public._norm_matricula(o.matricula) <> v_mat
      and o.id <> new.id
  ) then
    raise exception 'Este e-mail já tem outra matrícula cadastrada.' using errcode = '23505';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists contract_members_consistencia on public.contract_members;
create trigger contract_members_consistencia
  before insert or update on public.contract_members
  for each row execute function public._contract_members_consistencia();

-- 7.4) Quem é o usuário logado ------------------------------------------------------------------
-- E-mail do usuário logado, só se confirmado no Supabase Auth (nunca o que o aparelho informa)
create or replace function public._email_atual()
returns text language sql stable
security definer
set search_path = public
as $$
  select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

create or replace function public.is_master()
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.masters m where m.email = public._email_atual());
$$;

-- Vínculos ATIVOS do usuário logado em contratos ativos
create or replace function public._meus_vinculos()
returns table (contrato_id uuid, contrato text, role text)
language sql stable
security definer
set search_path = public
as $$
  select c.id, c.nome, m.role
  from public.contract_members m
  join public.contracts c on c.id = m.contrato_id
  where m.ativo and c.ativo and m.email = public._email_atual();
$$;

-- Contratos do técnico logado (usado pelo app: campo Contrato, histórico da equipe, fotos).
-- Agora só vínculos ativos: desativar um técnico corta o acesso aos dados do contrato.
create or replace function public.my_contracts()
returns setof text
language sql stable
security definer
set search_path = public
as $$
  select distinct v.contrato from public._meus_vinculos() v;
$$;

-- Papel do usuário logado para a interface: { master, contratos: [{ id, nome, role }] }.
-- Master vê todos os contratos (role 'master'); gestor/técnico, só os seus.
create or replace function public.my_access()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'master', public.is_master(),
    'contratos', coalesce(
      case when public.is_master() then
        (select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'role', 'master') order by c.nome)
         from public.contracts c where c.ativo)
      else
        (select jsonb_agg(jsonb_build_object('id', v.contrato_id, 'nome', v.contrato, 'role', v.role) order by v.contrato)
         from public._meus_vinculos() v)
      end, '[]'::jsonb)
  );
$$;

-- Master ou gestor ativo do contrato
create or replace function public._pode_gerir(p_contrato_id uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select public.is_master()
      or exists (select 1 from public._meus_vinculos() v where v.contrato_id = p_contrato_id and v.role = 'gestor');
$$;

create or replace function public._tecnicos_ativos(p_contrato_id uuid)
returns integer language sql stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.contract_members m
  where m.contrato_id = p_contrato_id and m.role = 'tecnico' and m.ativo;
$$;

-- 7.5) Gestão de Equipe (gestor do contrato ou master) -------------------------------------------
-- Equipe do contrato + cota: { contrato_id, contrato, max_technicians, tecnicos_ativos, membros: [...] }
create or replace function public.team_list(p_contrato_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  c public.contracts;
begin
  if not public._pode_gerir(p_contrato_id) then
    raise exception 'Sem permissão para gerir a equipe deste contrato.' using errcode = '42501';
  end if;
  select * into c from public.contracts where id = p_contrato_id;
  if not found then raise exception 'Contrato não encontrado.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'contrato_id', c.id, 'contrato', c.nome, 'max_technicians', c.max_technicians,
    'tecnicos_ativos', public._tecnicos_ativos(c.id),
    'membros', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'email', m.email, 'matricula', m.matricula,
                                          'role', m.role, 'ativo', m.ativo, 'created_at', m.created_at)
                       order by m.role, m.nome nulls last, m.email)
      from public.contract_members m where m.contrato_id = c.id), '[]'::jsonb)
  );
end;
$$;

-- Vincula um técnico ao contrato (chamada pela Edge Function create-technician COM o token do gestor,
-- antes — p_somente_validar — e depois de criar a conta no Supabase Auth). Confere o papel de quem chama,
-- a cota (com o contrato travado: dois cadastros ao mesmo tempo não furam o limite) e a matrícula.
create or replace function public.team_add_technician(
  p_contrato_id uuid, p_email text, p_nome text, p_matricula text, p_somente_validar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contracts;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_mat text := public._norm_matricula(p_matricula);
  v_existente public.contract_members;
begin
  if not public._pode_gerir(p_contrato_id) then
    raise exception 'Sem permissão para cadastrar técnicos neste contrato.' using errcode = '42501';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'E-mail inválido.' using errcode = '22023'; end if;
  if v_mat is null then raise exception 'Informe a matrícula funcional.' using errcode = '22023'; end if;
  if btrim(coalesce(p_nome, '')) = '' then raise exception 'Informe o nome completo.' using errcode = '22023'; end if;

  select * into c from public.contracts where id = p_contrato_id for update;
  if not found or not c.ativo then raise exception 'Contrato não encontrado ou inativo.' using errcode = 'P0002'; end if;

  select * into v_existente from public.contract_members m where m.contrato_id = c.id and m.email = v_email;
  if found and v_existente.ativo then
    raise exception 'Este e-mail já faz parte da equipe deste contrato.' using errcode = '23505';
  end if;
  if public._tecnicos_ativos(c.id) >= c.max_technicians then
    raise exception 'Limite de % técnicos liberados para este contrato atingido. Peça ao master para ampliar a licença.', c.max_technicians
      using errcode = 'P0001', hint = 'cota';
  end if;
  if exists (select 1 from public.contract_members o where public._norm_matricula(o.matricula) = v_mat and o.email <> v_email) then
    raise exception 'Matrícula % já está cadastrada para outra pessoa.', upper(btrim(p_matricula)) using errcode = '23505';
  end if;

  if p_somente_validar then
    return jsonb_build_object('ok', true, 'max_technicians', c.max_technicians, 'tecnicos_ativos', public._tecnicos_ativos(c.id));
  end if;

  if v_existente.id is not null then
    update public.contract_members set ativo = true, role = 'tecnico', nome = btrim(p_nome), matricula = p_matricula
      where id = v_existente.id;
  else
    insert into public.contract_members (email, contrato, contrato_id, nome, matricula, role, ativo)
      values (v_email, c.nome, c.id, btrim(p_nome), p_matricula, 'tecnico', true);
  end if;
  return public.team_list(c.id);
end;
$$;

-- Ativa / desativa o acesso de um membro. Gestor só mexe em técnicos; gestores, só o master.
-- Reativar respeita a cota.
create or replace function public.team_set_active(p_member_id uuid, p_ativo boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.contract_members;
  c public.contracts;
begin
  select * into m from public.contract_members where id = p_member_id;
  if not found or not public._pode_gerir(m.contrato_id) then
    raise exception 'Sem permissão para alterar este acesso.' using errcode = '42501';
  end if;
  if m.role = 'gestor' and not public.is_master() then
    raise exception 'Somente o master altera o acesso de gestores.' using errcode = '42501';
  end if;
  select * into c from public.contracts where id = m.contrato_id for update;
  if m.ativo is distinct from p_ativo then
    if p_ativo and m.role = 'tecnico' and public._tecnicos_ativos(c.id) >= c.max_technicians then
      raise exception 'Limite de % técnicos liberados para este contrato atingido. Peça ao master para ampliar a licença.', c.max_technicians
        using errcode = 'P0001', hint = 'cota';
    end if;
    update public.contract_members set ativo = p_ativo where id = p_member_id;
  end if;
  return public.team_list(c.id);
end;
$$;

-- 7.6) Login por matrícula (só a Edge Function, com a chave de serviço) ------------------------------
-- A matrícula vira e-mail SÓ dentro do servidor: o app nunca recebe o e-mail de ninguém.
-- Trava contra tentativa e erro: 5 falhas em 15 min bloqueiam a matrícula por 15 min.
create table if not exists public.login_tentativas (
  matricula_norm text        not null,
  ok             boolean     not null,
  quando         timestamptz not null default now()
);
create index if not exists login_tentativas_idx on public.login_tentativas (matricula_norm, quando desc);
alter table public.login_tentativas enable row level security;

-- { email, bloqueado }: email nulo = matrícula inexistente ou sem acesso ativo (o app mostra a mesma
-- mensagem genérica de senha errada)
create or replace function public.login_matricula_preparar(p_matricula text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat text := public._norm_matricula(p_matricula);
  v_falhas integer;
begin
  if v_mat is null then return jsonb_build_object('email', null, 'bloqueado', false); end if;
  select count(*) into v_falhas from public.login_tentativas t
    where t.matricula_norm = v_mat and not t.ok and t.quando > now() - interval '15 minutes';
  if v_falhas >= 5 then return jsonb_build_object('email', null, 'bloqueado', true); end if;
  return jsonb_build_object('bloqueado', false, 'email', (
    select m.email from public.contract_members m join public.contracts c on c.id = m.contrato_id
    where public._norm_matricula(m.matricula) = v_mat and m.ativo and c.ativo
    limit 1));
end;
$$;

create or replace function public.login_matricula_registrar(p_matricula text, p_ok boolean)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_tentativas where quando < now() - interval '1 day';
  insert into public.login_tentativas (matricula_norm, ok)
    select public._norm_matricula(p_matricula), p_ok where public._norm_matricula(p_matricula) is not null;
$$;

-- 7.7) Histórico do contrato sem limite (busca no servidor, em páginas) -----------------------------
-- O aparelho continua guardando os últimos 30 dias (list_team_reports) para uso offline; esta busca
-- consulta TODO o acervo dos contratos do técnico, sem limite de data, 50 por página (máx. 200).
-- p_before: client_created_at do último item da página anterior.
create or replace function public._sem_acento(t text)
returns text language sql immutable
set search_path = pg_catalog
as $$
  select translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
$$;

create or replace function public.search_team_reports(
  p_query text default '', p_module text default null, p_before timestamptz default null, p_limit integer default 50)
returns table (unique_id uuid, module text, payload jsonb, photos jsonb, contrato text, user_email text,
               client_created_at timestamptz, received_at timestamptz)
language plpgsql stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_termos text[] := array(select w from regexp_split_to_table(public._sem_acento(btrim(coalesce(p_query, ''))), '\s+') w where w <> '');
begin
  if auth.uid() is null then raise exception 'login necessário' using errcode = '42501'; end if;
  return query
    with meus as (select public._norm_contrato(c) as c from public.my_contracts() c),
    todos as (
      select r.unique_id, r.module, r.payload, r.photos, r.contrato, r.user_email, r.client_created_at, r.received_at, r.poco, r.cliente, r.report_date from public.bdo_reports r
      union all
      select r.unique_id, r.module, r.payload, r.photos, r.contrato, r.user_email, r.client_created_at, r.received_at, r.poco, r.cliente, r.report_date from public.technical_visits r
      union all
      select r.unique_id, r.module, r.payload, r.photos, r.contrato, r.user_email, r.client_created_at, r.received_at, r.poco, r.cliente, r.report_date from public.execution_reports r
    )
    select t.unique_id, t.module, t.payload, t.photos, t.contrato, t.user_email, t.client_created_at, t.received_at
    from todos t
    where public._norm_contrato(t.contrato) in (select c from meus)
      and (p_module is null or t.module = p_module)
      and (p_before is null or t.client_created_at < p_before)
      and not exists (
        select 1 from unnest(v_termos) w
        where position(w in public._sem_acento(concat_ws(' ', t.poco, t.cliente, t.contrato, t.user_email, t.module,
              case t.module when 'bdo' then 'bdo-e' when 'visita_tecnica' then 'visita tecnica' else 'execucao' end,
              to_char(t.report_date, 'DD/MM/YYYY'), t.unique_id::text))) = 0)
    order by t.client_created_at desc
    limit v_limit;
end;
$$;

-- 7.8) Envio de relatórios: só usuário logado, e só para os PRÓPRIOS contratos ----------------------
-- Relatório sem contrato continua aceito (técnico sem contrato vinculado). Relatório de um contrato que
-- não é do técnico NÃO é gravado nem confirmado (fica na fila do aparelho com erro): ninguém grava no
-- contrato dos outros.
create or replace function public.submit_reports(reports jsonb)
returns table (unique_id uuid, id bigint)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid   uuid := auth.uid();
  v_email text := nullif(auth.jwt()->>'email', '');
  v_ok    jsonb;
begin
  if v_uid is null then
    raise exception 'login necessário' using errcode = '42501';
  end if;
  if jsonb_typeof(reports) <> 'array' then
    raise exception 'reports deve ser um array JSON';
  end if;
  if jsonb_array_length(reports) > 50 then
    raise exception 'lote acima de 50 relatórios';
  end if;
  if exists (select 1 from jsonb_array_elements(reports) x where coalesce(x->>'module', '') not in ('bdo', 'visita_tecnica', 'handover')) then
    raise exception 'tipo de relatório desconhecido';
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_ok
  from jsonb_array_elements(reports) as x
  where public._norm_contrato(x->'payload'->>'contrato') = ''
     or public._norm_contrato(x->'payload'->>'contrato') in (select public._norm_contrato(c) from public.my_contracts() c);

  insert into public.bdo_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'bdo'
  on conflict (unique_id) do nothing;

  insert into public.technical_visits (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'visita_tecnica'
  on conflict (unique_id) do nothing;

  insert into public.execution_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'handover'
  on conflict (unique_id) do nothing;

  -- confirmação só dos aceitos (e já gravados); o envio do mesmo relatório por OUTRO usuário não é confirmado
  return query
    with ids as (select (x->>'unique_id')::uuid as u from jsonb_array_elements(v_ok) as x)
    select r.unique_id, r.id from public.bdo_reports r       where r.unique_id in (select u from ids) and r.user_id = v_uid
    union all
    select r.unique_id, r.id from public.technical_visits r  where r.unique_id in (select u from ids) and r.user_id = v_uid
    union all
    select r.unique_id, r.id from public.execution_reports r where r.unique_id in (select u from ids) and r.user_id = v_uid;
end;
$$;

-- Fotos e cópias PDF/Word: envio só por usuário logado
drop policy if exists "report-photos: upload" on storage.objects;
create policy "report-photos: upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'report-photos');
drop policy if exists "report-share: upload" on storage.objects;
create policy "report-share: upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'report-share');

-- 7.9) Permissões das funções ------------------------------------------------------------------------
-- Internas: ninguém chama pela API
revoke all on function public._norm_matricula(text) from public, anon, authenticated;
revoke all on function public._email_atual() from public, anon, authenticated;
revoke all on function public._meus_vinculos() from public, anon, authenticated;
revoke all on function public._pode_gerir(uuid) from public, anon, authenticated;
revoke all on function public._tecnicos_ativos(uuid) from public, anon, authenticated;
revoke all on function public._contract_members_consistencia() from public, anon, authenticated;
-- Usuário logado
revoke all on function public.is_master() from public, anon;
grant execute on function public.is_master() to authenticated;
revoke all on function public.my_contracts() from public, anon;
grant execute on function public.my_contracts() to authenticated;
revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;
revoke all on function public.team_list(uuid) from public, anon;
grant execute on function public.team_list(uuid) to authenticated;
revoke all on function public.team_add_technician(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.team_add_technician(uuid, text, text, text, boolean) to authenticated;
revoke all on function public.team_set_active(uuid, boolean) from public, anon;
grant execute on function public.team_set_active(uuid, boolean) to authenticated;
revoke all on function public.search_team_reports(text, text, timestamptz, integer) from public, anon;
grant execute on function public.search_team_reports(text, text, timestamptz, integer) to authenticated;
revoke all on function public.submit_reports(jsonb) from public, anon;
grant execute on function public.submit_reports(jsonb) to authenticated;
-- Só a Edge Function de login (chave de serviço)
revoke all on function public.login_matricula_preparar(text) from public, anon, authenticated;
grant execute on function public.login_matricula_preparar(text) to service_role;
revoke all on function public.login_matricula_registrar(text, boolean) from public, anon, authenticated;
grant execute on function public.login_matricula_registrar(text, boolean) to service_role;
