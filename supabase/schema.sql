-- =====================================================================
-- BDO-e & Inspeção Técnica — esquema Supabase
-- Execute no Supabase: SQL Editor → New query → cole e rode.
-- =====================================================================

-- 1) Tabela única de relatórios (versões anteriores) ------------------
-- Mantida só como legado: os dados são copiados para as tabelas por tipo (seção 2) e a função
-- submit_reports passou a gravar nelas.
create table if not exists public.reports (
  id                bigint generated always as identity primary key,
  unique_id         uuid        not null,
  base              text        check (base in ('BA', 'SE')), -- legado: o app não usa mais base (vem nulo)
  module            text        not null check (module in ('visita_tecnica', 'bdo', 'handover')),
  content_hash      text        not null,
  payload           jsonb       not null,
  photos            jsonb       not null default '[]', -- [{ path, category, name, field, fase, legenda }]
  client_created_at timestamptz not null,
  received_at       timestamptz not null default now(),
  constraint reports_unique_id_key unique (unique_id)
);

-- Migração de bancos criados com a versão anterior (seleção BA/SE)
alter table public.reports alter column base drop not null;
alter table public.reports drop constraint if exists reports_visita_somente_ba;
drop index if exists public.reports_base_module_idx;

create index if not exists reports_module_idx on public.reports (module, client_created_at desc);

-- RLS ligado e SEM políticas para anon: ninguém lê/escreve a tabela diretamente
-- com a chave pública. A gravação acontece só pela função abaixo.
alter table public.reports enable row level security;

-- 2) Tabelas por tipo de relatório --------------------------------------
-- Mesmas colunas nas três; payload = relatório completo (jsonb). Colunas de busca (poço, data, cliente,
-- contrato) são extraídas do payload pelo servidor. user_id/user_email vêm do token do Supabase Auth
-- (técnico logado); sem login, user_email é o informado pelo aparelho e user_id fica nulo.
create table if not exists public.bdo_reports (
  id                bigint generated always as identity primary key,
  unique_id         uuid        not null unique,
  module            text        not null default 'bdo' check (module = 'bdo'),
  content_hash      text        not null,
  payload           jsonb       not null,
  photos            jsonb       not null default '[]', -- [{ path, category, name, field, fase, legenda }] no bucket report-photos
  poco              text,
  report_date       date,
  cliente           text,
  contrato          text,
  user_id           uuid        references auth.users (id) on delete set null,
  user_email        text,
  device_id         uuid,
  client_created_at timestamptz not null,
  received_at       timestamptz not null default now()
);

create table if not exists public.technical_visits (
  id                bigint generated always as identity primary key,
  unique_id         uuid        not null unique,
  module            text        not null default 'visita_tecnica' check (module = 'visita_tecnica'),
  content_hash      text        not null,
  payload           jsonb       not null,
  photos            jsonb       not null default '[]',
  poco              text,
  report_date       date,
  cliente           text,
  contrato          text,
  user_id           uuid        references auth.users (id) on delete set null,
  user_email        text,
  device_id         uuid,
  client_created_at timestamptz not null,
  received_at       timestamptz not null default now()
);

create table if not exists public.execution_reports (
  id                bigint generated always as identity primary key,
  unique_id         uuid        not null unique,
  module            text        not null default 'handover' check (module = 'handover'),
  content_hash      text        not null,
  payload           jsonb       not null,
  photos            jsonb       not null default '[]',
  poco              text,
  report_date       date,
  cliente           text,
  contrato          text,
  user_id           uuid        references auth.users (id) on delete set null,
  user_email        text,
  device_id         uuid,
  client_created_at timestamptz not null,
  received_at       timestamptz not null default now()
);

create index if not exists bdo_reports_poco_idx       on public.bdo_reports (poco, report_date desc);
create index if not exists technical_visits_poco_idx  on public.technical_visits (poco, report_date desc);
create index if not exists execution_reports_poco_idx on public.execution_reports (poco, report_date desc);

-- RLS ligado e SEM políticas: ninguém lê/escreve as tabelas direto com a chave pública
alter table public.bdo_reports       enable row level security;
alter table public.technical_visits  enable row level security;
alter table public.execution_reports enable row level security;

-- Data do relatório no payload: BDO/Visita = "data"; Execução = "data_hora" (AAAA-MM-DDTHH:MM)
create or replace function public._report_date(p jsonb)
returns date language sql immutable as $$
  select case when coalesce(p->>'data', p->>'data_hora', '') ~ '^\d{4}-\d{2}-\d{2}'
              then left(coalesce(p->>'data', p->>'data_hora'), 10)::date end;
$$;

-- Migração: relatórios gravados na tabela única antiga (public.reports) vão para a tabela do seu tipo
insert into public.bdo_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, client_created_at, received_at)
  select unique_id, content_hash, payload, photos, payload->>'poco', public._report_date(payload), payload->>'cliente', payload->>'contrato', client_created_at, received_at
  from public.reports where module = 'bdo' on conflict (unique_id) do nothing;
insert into public.technical_visits (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, client_created_at, received_at)
  select unique_id, content_hash, payload, photos, payload->>'poco', public._report_date(payload), payload->>'cliente', payload->>'contrato', client_created_at, received_at
  from public.reports where module = 'visita_tecnica' on conflict (unique_id) do nothing;
insert into public.execution_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, client_created_at, received_at)
  select unique_id, content_hash, payload, photos, payload->>'poco', public._report_date(payload), payload->>'cliente', payload->>'contrato', client_created_at, received_at
  from public.reports where module = 'handover' on conflict (unique_id) do nothing;

-- 3) Gravação em lote, idempotente ------------------------------------
-- Recebe um array JSON de relatórios e grava cada um na tabela do seu tipo. Ignora unique_id já
-- existentes e devolve (unique_id, id) de TODOS os itens do lote — inclusive os já gravados antes —
-- que é a confirmação explícita usada pelo app para liberar a fila de envio.
-- Empresa prestadora do cabeçalho (congelada no relatório ao finalizar: payload._empresa)
alter table public.bdo_reports       add column if not exists empresa_nome text;
alter table public.bdo_reports       add column if not exists empresa_cnpj text;
alter table public.technical_visits  add column if not exists empresa_nome text;
alter table public.technical_visits  add column if not exists empresa_cnpj text;
alter table public.execution_reports add column if not exists empresa_nome text;
alter table public.execution_reports add column if not exists empresa_cnpj text;
update public.bdo_reports       set empresa_nome = payload->'_empresa'->>'nome', empresa_cnpj = payload->'_empresa'->>'cnpj' where empresa_nome is null and payload->'_empresa'->>'nome' is not null;
update public.technical_visits  set empresa_nome = payload->'_empresa'->>'nome', empresa_cnpj = payload->'_empresa'->>'cnpj' where empresa_nome is null and payload->'_empresa'->>'nome' is not null;
update public.execution_reports set empresa_nome = payload->'_empresa'->>'nome', empresa_cnpj = payload->'_empresa'->>'cnpj' where empresa_nome is null and payload->'_empresa'->>'nome' is not null;

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
begin
  if jsonb_typeof(reports) <> 'array' then
    raise exception 'reports deve ser um array JSON';
  end if;
  if jsonb_array_length(reports) > 50 then
    raise exception 'lote acima de 50 relatórios';
  end if;
  if exists (select 1 from jsonb_array_elements(reports) x where coalesce(x->>'module', '') not in ('bdo', 'visita_tecnica', 'handover')) then
    raise exception 'tipo de relatório desconhecido';
  end if;

  insert into public.bdo_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(reports) as x where x->>'module' = 'bdo'
  on conflict (unique_id) do nothing;

  insert into public.technical_visits (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(reports) as x where x->>'module' = 'visita_tecnica'
  on conflict (unique_id) do nothing;

  insert into public.execution_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(reports) as x where x->>'module' = 'handover'
  on conflict (unique_id) do nothing;

  return query
    with ids as (select (x->>'unique_id')::uuid as u from jsonb_array_elements(reports) as x)
    select r.unique_id, r.id from public.bdo_reports r       where r.unique_id in (select u from ids)
    union all
    select r.unique_id, r.id from public.technical_visits r  where r.unique_id in (select u from ids)
    union all
    select r.unique_id, r.id from public.execution_reports r where r.unique_id in (select u from ids);
end;
$$;

revoke all on function public.submit_reports(jsonb) from public;
grant execute on function public.submit_reports(jsonb) to anon, authenticated;

-- 4) Storage para fotos -----------------------------------------------
insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', false)
on conflict (id) do nothing;

-- Apenas envio (insert). Sem leitura/alteração/exclusão pela chave pública.
drop policy if exists "report-photos: upload" on storage.objects;
create policy "report-photos: upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'report-photos');

-- 4b) Links de relatório para o WhatsApp ---------------------------------
-- Bucket PÚBLICO só para leitura por URL direta: o caminho é <módulo>/<uniqueId>.pdf|docx (UUID, não
-- adivinhável). Sem política de SELECT → ninguém lista o bucket; anon só envia (INSERT).
insert into storage.buckets (id, name, public)
values ('report-share', 'report-share', true)
on conflict (id) do nothing;

drop policy if exists "report-share: upload" on storage.objects;
create policy "report-share: upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'report-share');

-- 5) Configurações da empresa / equipe (por aparelho) --------------------
-- Uma linha por aparelho, com o técnico logado. Colunas de busca extraídas do JSON; o JSON completo
-- (inclui o logo, data URL redimensionado) fica em settings.
create table if not exists public.company_settings (
  device_id       uuid        primary key,
  user_id         uuid        references auth.users (id) on delete set null,
  user_email      text,
  empresa_nome    text,
  empresa_cnpj    text,
  cliente_padrao  text,
  contrato_padrao text,
  tecnico_nome    text,
  settings        jsonb       not null,
  updated_at      timestamptz not null,       -- horário da alteração no aparelho
  received_at     timestamptz not null default now()
);

alter table public.company_settings enable row level security;

-- Tabela da versão anterior (só configurações em JSON): mantida como legado e copiada para company_settings
create table if not exists public.device_settings (
  device_id   uuid        primary key,
  settings    jsonb       not null,
  updated_at  timestamptz not null,
  received_at timestamptz not null default now()
);
alter table public.device_settings enable row level security;

insert into public.company_settings (device_id, empresa_nome, empresa_cnpj, cliente_padrao, contrato_padrao, tecnico_nome, settings, updated_at, received_at)
  select device_id, settings->>'empresa_nome', settings->>'empresa_cnpj', settings->>'cliente_padrao', settings->>'contrato_padrao',
         settings->>'tecnico_nome', settings, updated_at, received_at
  from public.device_settings
on conflict (device_id) do nothing;

-- Upsert idempotente: só sobrescreve se a versão recebida for mais nova.
-- Devolve o device_id como confirmação explícita para o app.
create or replace function public.save_company_settings(p_device_id uuid, p_settings jsonb, p_updated_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_settings as c
    (device_id, user_id, user_email, empresa_nome, empresa_cnpj, cliente_padrao, contrato_padrao, tecnico_nome, settings, updated_at)
  values (p_device_id, auth.uid(), nullif(auth.jwt()->>'email', ''), p_settings->>'empresa_nome', p_settings->>'empresa_cnpj',
          p_settings->>'cliente_padrao', p_settings->>'contrato_padrao', p_settings->>'tecnico_nome', p_settings, p_updated_at)
  on conflict (device_id) do update
    set user_id = coalesce(excluded.user_id, c.user_id), user_email = coalesce(excluded.user_email, c.user_email),
        empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj,
        cliente_padrao = excluded.cliente_padrao, contrato_padrao = excluded.contrato_padrao, tecnico_nome = excluded.tecnico_nome,
        settings = excluded.settings, updated_at = excluded.updated_at, received_at = now()
    where c.updated_at < excluded.updated_at;
  return p_device_id;
end;
$$;

revoke all on function public.save_company_settings(uuid, jsonb, timestamptz) from public;
grant execute on function public.save_company_settings(uuid, jsonb, timestamptz) to anon, authenticated;

-- Aparelhos com a versão anterior do app ainda chamam save_device_settings: grava em company_settings
create or replace function public.save_device_settings(p_device_id uuid, p_settings jsonb, p_updated_at timestamptz)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.save_company_settings(p_device_id, p_settings, p_updated_at);
$$;

revoke all on function public.save_device_settings(uuid, jsonb, timestamptz) from public;
grant execute on function public.save_device_settings(uuid, jsonb, timestamptz) to anon, authenticated;

-- Leitura: configurações mais recentes do técnico logado (qualquer aparelho dele), para o cabeçalho
-- dos relatórios (empresa, CNPJ, logo) num aparelho novo. Só para authenticated; nunca de outro usuário.
create or replace function public.my_company_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('settings', c.settings, 'updated_at', c.updated_at)
  from public.company_settings c
  where auth.uid() is not null
    and (c.user_id = auth.uid()
         or (c.user_email is not null and lower(c.user_email) = lower(nullif(auth.jwt()->>'email', ''))))
  order by c.updated_at desc
  limit 1;
$$;

revoke all on function public.my_company_settings() from public, anon;
grant execute on function public.my_company_settings() to authenticated;

-- 6) Equipe por contrato: leitura do histórico (pull) ---------------------
-- Quem pertence a cada contrato é definido AQUI, pelo administrador (Table Editor ou SQL), nunca pelo
-- aparelho: o técnico logado (e-mail CONFIRMADO no Supabase Auth) recebe os relatórios de todos os
-- contratos em que estiver cadastrado. Ex.:
--   insert into public.contract_members (email, contrato) values ('tecnico@empresa.com', 'OS-Mans');
-- Recomendado: desligar o cadastro público (Authentication › Providers › Email › "Allow new users to sign up")
-- e criar os usuários pelo painel.
create table if not exists public.contract_members (
  email      text        not null,
  contrato   text        not null,
  created_at timestamptz not null default now(),
  primary key (email, contrato)
);
alter table public.contract_members enable row level security; -- sem políticas: só o administrador mexe

-- Compara contratos ignorando maiúsculas, espaços, hífen, ponto e sublinhado: "Os Mans" = "OS-MANS" = "os.mans".
-- Qualquer sequência de caracteres que não seja letra ou número vira UM espaço e as pontas são aparadas
-- (todos acima viram "OS MANS"); sem separador nenhum ("OSMANS") é outro contrato.
-- Mesma regra no app: normContrato em src/core/contratos.js.
create or replace function public._norm_contrato(t text)
returns text language sql immutable
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(upper(coalesce(t, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create index if not exists bdo_reports_contrato_idx       on public.bdo_reports (public._norm_contrato(contrato), client_created_at desc);
create index if not exists technical_visits_contrato_idx  on public.technical_visits (public._norm_contrato(contrato), client_created_at desc);
create index if not exists execution_reports_contrato_idx on public.execution_reports (public._norm_contrato(contrato), client_created_at desc);

-- Contratos do técnico logado (vazio sem login ou com e-mail não confirmado)
create or replace function public.my_contracts()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct m.contrato
  from public.contract_members m
  join auth.users u on lower(u.email) = lower(m.email)
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

revoke all on function public.my_contracts() from public, anon;
grant execute on function public.my_contracts() to authenticated;

-- Relatórios da equipe a partir de p_since (no máximo 90 dias e 1000 relatórios por chamada)
create or replace function public.list_team_reports(p_since timestamptz)
returns table (unique_id uuid, module text, payload jsonb, photos jsonb, contrato text, user_email text,
               client_created_at timestamptz, received_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_since timestamptz := greatest(coalesce(p_since, now() - interval '30 days'), now() - interval '90 days');
begin
  if auth.uid() is null then
    raise exception 'login necessário';
  end if;
  return query
    with meus as (select public._norm_contrato(c) as c from public.my_contracts() c),
    todos as (
      select r.unique_id, r.module, r.payload, r.photos, r.contrato, r.user_email, r.client_created_at, r.received_at from public.bdo_reports r
      union all
      select r.unique_id, r.module, r.payload, r.photos, r.contrato, r.user_email, r.client_created_at, r.received_at from public.technical_visits r
      union all
      select r.unique_id, r.module, r.payload, r.photos, r.contrato, r.user_email, r.client_created_at, r.received_at from public.execution_reports r
    )
    select t.unique_id, t.module, t.payload, t.photos, t.contrato, t.user_email, t.client_created_at, t.received_at
    from todos t
    where public._norm_contrato(t.contrato) in (select c from meus) and t.client_created_at >= v_since
    order by t.client_created_at desc
    limit 1000;
end;
$$;

revoke all on function public.list_team_reports(timestamptz) from public, anon;
grant execute on function public.list_team_reports(timestamptz) to authenticated;

-- O relatório (pelo unique_id) é de um contrato do técnico logado? Usado na leitura das fotos.
create or replace function public.can_read_report(p_unique_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_unique_id is not null and exists (
    select 1 from (
      select contrato from public.bdo_reports where unique_id = p_unique_id
      union all select contrato from public.technical_visits where unique_id = p_unique_id
      union all select contrato from public.execution_reports where unique_id = p_unique_id
    ) r
    where public._norm_contrato(r.contrato) in (select public._norm_contrato(c) from public.my_contracts() c)
  );
$$;

revoke all on function public.can_read_report(uuid) from public, anon;
grant execute on function public.can_read_report(uuid) to authenticated;

-- Fotos: caminho <módulo>/<unique_id>/<arquivo>. Leitura só para técnico logado do mesmo contrato
-- (o bucket continua privado; anon segue só com INSERT).
create or replace function public._uuid_or_null(t text)
returns uuid language sql immutable as $$
  select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end;
$$;

drop policy if exists "report-photos: equipe le" on storage.objects;
create policy "report-photos: equipe le"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'report-photos' and public.can_read_report(public._uuid_or_null((storage.foldername(name))[2])));

-- =====================================================================
-- 7) Gestão de Equipe — migração 001
-- Contratos com cota de técnicos (max_technicians), papéis (gestor / técnico), matrícula,
-- busca ilimitada no histórico do contrato e isolamento por contrato.
-- Idempotente: pode rodar mais de uma vez. Rode inteiro no SQL Editor do projeto BDO eletronico.
-- (O mesmo texto está no fim de supabase/schema.sql — um teste confere que são iguais.)
-- =====================================================================

-- 7.1) Sem "master geral" no app --------------------------------------------------------------
-- O Master (dono da licença) administra pelo Painel de Licenças e, neste banco, só pelo SQL Editor:
-- cadastra o primeiro gestor de cada cliente e amplia a cota (max_technicians). No app, quem manda na
-- equipe é o GESTOR do contrato; nenhuma conta do app enxerga os dados de todas as empresas.
-- (Remove o que uma versão anterior desta migração tenha criado.)
drop function if exists public.is_master();
drop table if exists public.masters;

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

-- Papel do usuário logado para a interface: { contratos: [{ id, nome, role: 'gestor'|'tecnico' }] }.
-- Só os contratos dele (gestor de um contrato pode ser técnico de outro).
create or replace function public.my_access()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object('contratos', coalesce(
    (select jsonb_agg(jsonb_build_object('id', v.contrato_id, 'nome', v.contrato, 'role', v.role) order by v.contrato)
     from public._meus_vinculos() v), '[]'::jsonb));
$$;

-- Gestor ativo do contrato (o único papel do app que gerencia equipe)
create or replace function public._pode_gerir(p_contrato_id uuid)
returns boolean language sql stable
security definer
set search_path = public
as $$
  select exists (select 1 from public._meus_vinculos() v where v.contrato_id = p_contrato_id and v.role = 'gestor');
$$;

create or replace function public._tecnicos_ativos(p_contrato_id uuid)
returns integer language sql stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.contract_members m
  where m.contrato_id = p_contrato_id and m.role = 'tecnico' and m.ativo;
$$;

-- 7.5) Gestão de Equipe (gestor do contrato) ------------------------------------------------------
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
    raise exception 'Limite de % técnicos liberados para este contrato atingido. Entre em contato com o Master para ampliar a licença.', c.max_technicians
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

-- Ativa / desativa o acesso de um membro. O gestor mexe nos técnicos; gestores só pelo Master (SQL Editor).
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
  if m.role = 'gestor' then
    raise exception 'O acesso de gestores é alterado pelo Master da licença.' using errcode = '42501';
  end if;
  select * into c from public.contracts where id = m.contrato_id for update;
  if m.ativo is distinct from p_ativo then
    if p_ativo and m.role = 'tecnico' and public._tecnicos_ativos(c.id) >= c.max_technicians then
      raise exception 'Limite de % técnicos liberados para este contrato atingido. Entre em contato com o Master para ampliar a licença.', c.max_technicians
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

-- =====================================================================
-- 8) Login por matrícula — migração 002
-- O app manda matrícula + senha; o BANCO confere a senha (bcrypt do Supabase Auth, via pgcrypto) e só
-- devolve o e-mail se a senha estiver certa. Depois o próprio app entra no Supabase Auth com e-mail + senha
-- (do IP do aparelho: o limite de tentativas do Auth continua por aparelho, não um só para todos).
-- Quem não sabe a senha não descobre e-mail nenhum. 5 falhas em 15 min bloqueiam a matrícula por 15 min.
-- Substitui login_matricula_preparar / login_matricula_registrar da migração 001 (não chegaram a ser usadas).
-- Idempotente. Rode no SQL Editor do projeto BDO eletronico DEPOIS da 001.
-- =====================================================================

create or replace function public.login_matricula(p_matricula text, p_senha text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mat    text := public._norm_matricula(p_matricula);
  v_falhas integer;
  v_id     uuid;
  v_email  text;
  v_hash   text;
begin
  if v_mat is null or coalesce(p_senha, '') = '' then
    return jsonb_build_object('ok', false, 'bloqueado', false);
  end if;
  delete from public.login_tentativas where quando < now() - interval '1 day';
  select count(*) into v_falhas from public.login_tentativas t
    where t.matricula_norm = v_mat and not t.ok and t.quando > now() - interval '15 minutes';
  if v_falhas >= 5 then
    return jsonb_build_object('ok', false, 'bloqueado', true);
  end if;

  select u.id, u.email, u.encrypted_password into v_id, v_email, v_hash
  from public.contract_members m
  join public.contracts c on c.id = m.contrato_id
  join auth.users u on lower(u.email) = m.email
  where public._norm_matricula(m.matricula) = v_mat and m.ativo and c.ativo
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
  limit 1;

  if v_id is null or v_hash is null then
    -- mesmo custo de uma senha errada: o tempo de resposta não revela se a matrícula existe
    perform extensions.crypt(p_senha, extensions.gen_salt('bf', 10));
    insert into public.login_tentativas (matricula_norm, ok) values (v_mat, false);
    return jsonb_build_object('ok', false, 'bloqueado', false);
  end if;
  if v_hash <> extensions.crypt(p_senha, v_hash) then
    insert into public.login_tentativas (matricula_norm, ok) values (v_mat, false);
    return jsonb_build_object('ok', false, 'bloqueado', false);
  end if;
  insert into public.login_tentativas (matricula_norm, ok) values (v_mat, true);
  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

revoke all on function public.login_matricula(text, text) from public;
grant execute on function public.login_matricula(text, text) to anon, authenticated;

drop function if exists public.login_matricula_preparar(text);
drop function if exists public.login_matricula_registrar(text, boolean);

-- =====================================================================
-- 9) Empresa e logo POR CONTRATO — migração 003
-- Antes a empresa prestadora (nome, CNPJ, logo) ficava nas Configurações de cada aparelho/usuário
-- (company_settings): quem trocava de contrato continuava com a logo do contrato anterior. Agora ela é do
-- CONTRATO: o gestor define em Gestão de Equipe (team_set_company) e todos do contrato recebem
-- (my_contract_companies). O app usa a empresa do contrato escolhido no relatório; contrato sem empresa
-- definida sai como "Empresa Prestadora", sem logo.
-- Contratos ainda sem empresa recebem a das Configurações mais recentes de quem usa aquele contrato como
-- "Contrato padrão" (para não perder a logo que já estava em uso).
-- Idempotente. Rode no SQL Editor do projeto BDO eletronico DEPOIS da 001.
-- =====================================================================

alter table public.contracts add column if not exists empresa_nome text;
alter table public.contracts add column if not exists empresa_cnpj text;
alter table public.contracts add column if not exists empresa_logo text;
alter table public.contracts add column if not exists empresa_atualizada_em timestamptz;

-- Logo só PNG/JPEG em data URL (o app redimensiona para até 480×240 px) e com tamanho limitado
alter table public.contracts drop constraint if exists contracts_empresa_logo_check;
alter table public.contracts add constraint contracts_empresa_logo_check check (
  empresa_logo is null
  or (empresa_logo ~* '^data:image/(png|jpe?g);base64,' and length(empresa_logo) <= 700000)
);

-- Empresa dos contratos do usuário logado: [{ id, nome, empresa_nome, empresa_cnpj, empresa_logo, atualizada_em }]
create or replace function public.my_contract_companies()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'nome', c.nome,
      'empresa_nome', coalesce(c.empresa_nome, ''), 'empresa_cnpj', coalesce(c.empresa_cnpj, ''),
      'empresa_logo', coalesce(c.empresa_logo, ''), 'atualizada_em', c.empresa_atualizada_em
    ) order by c.nome), '[]'::jsonb)
  from public.contracts c
  where c.id in (select v.contrato_id from public._meus_vinculos() v);
$$;

-- Gestor do contrato grava a empresa (nome, CNPJ, logo). Texto vazio apaga o campo.
create or replace function public.team_set_company(p_contrato_id uuid, p_nome text, p_cnpj text, p_logo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_logo text := nullif(btrim(coalesce(p_logo, '')), '');
  c public.contracts;
begin
  if not public._pode_gerir(p_contrato_id) then
    raise exception 'Somente o gestor do contrato pode alterar a empresa.' using errcode = '42501';
  end if;
  if v_logo is not null and v_logo !~* '^data:image/(png|jpe?g);base64,' then
    raise exception 'A logo precisa ser uma imagem PNG ou JPEG.' using errcode = '22023';
  end if;
  if v_logo is not null and length(v_logo) > 700000 then
    raise exception 'A logo é grande demais. Use uma imagem menor.' using errcode = '22023';
  end if;
  update public.contracts
    set empresa_nome = nullif(btrim(coalesce(p_nome, '')), ''),
        empresa_cnpj = nullif(btrim(coalesce(p_cnpj, '')), ''),
        empresa_logo = v_logo,
        empresa_atualizada_em = now()
    where id = p_contrato_id
    returning * into c;
  return jsonb_build_object(
    'id', c.id, 'nome', c.nome,
    'empresa_nome', coalesce(c.empresa_nome, ''), 'empresa_cnpj', coalesce(c.empresa_cnpj, ''),
    'empresa_logo', coalesce(c.empresa_logo, ''), 'atualizada_em', c.empresa_atualizada_em);
end;
$$;

-- Contratos sem empresa: copia das Configurações mais recentes de quem tem aquele "Contrato padrão"
update public.contracts c
  set empresa_nome = nullif(btrim(s.settings->>'empresa_nome'), ''),
      empresa_cnpj = nullif(btrim(s.settings->>'empresa_cnpj'), ''),
      empresa_logo = case when s.settings->>'empresa_logo' ~* '^data:image/(png|jpe?g);base64,'
                           and length(s.settings->>'empresa_logo') <= 700000
                          then s.settings->>'empresa_logo' end,
      empresa_atualizada_em = now()
  from (
    select distinct on (public._norm_contrato(cs.contrato_padrao)) public._norm_contrato(cs.contrato_padrao) as norm, cs.settings
    from public.company_settings cs
    where coalesce(cs.contrato_padrao, '') <> ''
      and (coalesce(cs.settings->>'empresa_nome', '') <> '' or coalesce(cs.settings->>'empresa_logo', '') <> '')
    order by public._norm_contrato(cs.contrato_padrao), cs.updated_at desc
  ) s
  where s.norm = c.nome_norm
    and c.empresa_nome is null and c.empresa_cnpj is null and c.empresa_logo is null and c.empresa_atualizada_em is null;

revoke all on function public.my_contract_companies() from public, anon;
grant execute on function public.my_contract_companies() to authenticated;
revoke all on function public.team_set_company(uuid, text, text, text) from public, anon;
grant execute on function public.team_set_company(uuid, text, text, text) to authenticated;

-- 004 — Segurança das configurações (aplicada em produção em 2026-10-25)
-- save_company_settings continua aberta para anon (o app sincroniza as configurações antes do login),
-- mas recusa envio sem device_id, configurações que não sejam objeto JSON, acima de 1 MB ou com data no futuro.
-- save_device_settings (compatibilidade com versões antigas) só repassa para ela, então herda as mesmas travas.
-- _report_date e _uuid_or_null ganham search_path fixo (aviso do Security Advisor; só usam funções nativas).
create or replace function public.save_company_settings(p_device_id uuid, p_settings jsonb, p_updated_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_id is null then
    raise exception 'device_id obrigatório' using errcode = '22023';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'configurações inválidas' using errcode = '22023';
  end if;
  if octet_length(p_settings::text) > 1000000 then
    raise exception 'Configurações grandes demais. Use uma logo menor.' using errcode = '22023';
  end if;
  if p_updated_at is null or p_updated_at > now() + interval '1 day' then
    raise exception 'data de atualização inválida' using errcode = '22023';
  end if;

  insert into public.company_settings as c
    (device_id, user_id, user_email, empresa_nome, empresa_cnpj, cliente_padrao, contrato_padrao, tecnico_nome, settings, updated_at)
  values (p_device_id, auth.uid(), nullif(auth.jwt()->>'email', ''), p_settings->>'empresa_nome', p_settings->>'empresa_cnpj',
          p_settings->>'cliente_padrao', p_settings->>'contrato_padrao', p_settings->>'tecnico_nome', p_settings, p_updated_at)
  on conflict (device_id) do update
    set user_id = coalesce(excluded.user_id, c.user_id), user_email = coalesce(excluded.user_email, c.user_email),
        empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj,
        cliente_padrao = excluded.cliente_padrao, contrato_padrao = excluded.contrato_padrao, tecnico_nome = excluded.tecnico_nome,
        settings = excluded.settings, updated_at = excluded.updated_at, received_at = now()
    where c.updated_at < excluded.updated_at;
  return p_device_id;
end;
$$;

revoke all on function public.save_company_settings(uuid, jsonb, timestamptz) from public;
grant execute on function public.save_company_settings(uuid, jsonb, timestamptz) to anon, authenticated;

alter function public._report_date(jsonb) set search_path = '';
alter function public._uuid_or_null(text) set search_path = '';

-- 005) Relatório ATUALIZADO (Histórico › Reutilizar no app): o mesmo unique_id chega de novo com outro
-- conteúdo e substitui a versão anterior — sem duplicar. Só o próprio autor atualiza (user_id igual); envio
-- repetido com o mesmo conteúdo (content_hash) não mexe na linha. Antes: "on conflict do nothing" ignorava a
-- versão nova e o servidor ficava com a antiga.
alter table public.bdo_reports       add column if not exists updated_at timestamptz;
alter table public.technical_visits  add column if not exists updated_at timestamptz;
alter table public.execution_reports add column if not exists updated_at timestamptz;

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

  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_ok
  from (
    select distinct on (e.x->>'unique_id') e.x, e.o
    from jsonb_array_elements(reports) with ordinality as e(x, o)
    order by e.x->>'unique_id', e.o desc
  ) as d(x, o)
  where public._norm_contrato(x->'payload'->>'contrato') = ''
     or public._norm_contrato(x->'payload'->>'contrato') in (select public._norm_contrato(c) from public.my_contracts() c);

  insert into public.bdo_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'bdo'
  on conflict (unique_id) do update set
    content_hash = excluded.content_hash, payload = excluded.payload, photos = excluded.photos,
    poco = excluded.poco, report_date = excluded.report_date, cliente = excluded.cliente, contrato = excluded.contrato,
    empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj, device_id = excluded.device_id,
    updated_at = now()
  where bdo_reports.user_id = excluded.user_id and bdo_reports.content_hash is distinct from excluded.content_hash;

  insert into public.technical_visits (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'visita_tecnica'
  on conflict (unique_id) do update set
    content_hash = excluded.content_hash, payload = excluded.payload, photos = excluded.photos,
    poco = excluded.poco, report_date = excluded.report_date, cliente = excluded.cliente, contrato = excluded.contrato,
    empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj, device_id = excluded.device_id,
    updated_at = now()
  where technical_visits.user_id = excluded.user_id and technical_visits.content_hash is distinct from excluded.content_hash;

  insert into public.execution_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'handover'
  on conflict (unique_id) do update set
    content_hash = excluded.content_hash, payload = excluded.payload, photos = excluded.photos,
    poco = excluded.poco, report_date = excluded.report_date, cliente = excluded.cliente, contrato = excluded.contrato,
    empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj, device_id = excluded.device_id,
    updated_at = now()
  where execution_reports.user_id = excluded.user_id and execution_reports.content_hash is distinct from excluded.content_hash;

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

revoke all on function public.submit_reports(jsonb) from public, anon;
grant execute on function public.submit_reports(jsonb) to authenticated;

-- 006) Relatórios enviados ANTES do login obrigatório ficaram sem dono (user_id nulo, só o e-mail). Editar um
-- deles (Histórico › Editar) reenviava o mesmo unique_id, mas a 005 só atualiza linha do próprio user_id: a versão
-- nova não era gravada nem confirmada e ficava presa na fila. Agora a linha sem dono cujo e-mail é o do usuário
-- LOGADO (e-mail do token, nunca o do payload) passa a ser dele e recebe a versão nova (mesmo com o mesmo conteúdo,
-- para ser confirmada). Linha de outro dono continua intocável.
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

  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_ok
  from (
    select distinct on (e.x->>'unique_id') e.x, e.o
    from jsonb_array_elements(reports) with ordinality as e(x, o)
    order by e.x->>'unique_id', e.o desc
  ) as d(x, o)
  where public._norm_contrato(x->'payload'->>'contrato') = ''
     or public._norm_contrato(x->'payload'->>'contrato') in (select public._norm_contrato(c) from public.my_contracts() c);

  insert into public.bdo_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'bdo'
  on conflict (unique_id) do update set
    content_hash = excluded.content_hash, payload = excluded.payload, photos = excluded.photos,
    poco = excluded.poco, report_date = excluded.report_date, cliente = excluded.cliente, contrato = excluded.contrato,
    empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj, device_id = excluded.device_id,
    user_id = excluded.user_id, user_email = excluded.user_email, updated_at = now()
  where (bdo_reports.user_id = excluded.user_id and bdo_reports.content_hash is distinct from excluded.content_hash)
     or (bdo_reports.user_id is null and v_email is not null and lower(bdo_reports.user_email) = lower(v_email));

  insert into public.technical_visits (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'visita_tecnica'
  on conflict (unique_id) do update set
    content_hash = excluded.content_hash, payload = excluded.payload, photos = excluded.photos,
    poco = excluded.poco, report_date = excluded.report_date, cliente = excluded.cliente, contrato = excluded.contrato,
    empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj, device_id = excluded.device_id,
    user_id = excluded.user_id, user_email = excluded.user_email, updated_at = now()
  where (technical_visits.user_id = excluded.user_id and technical_visits.content_hash is distinct from excluded.content_hash)
     or (technical_visits.user_id is null and v_email is not null and lower(technical_visits.user_email) = lower(v_email));

  insert into public.execution_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, empresa_nome, empresa_cnpj, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         x->'payload'->'_empresa'->>'nome', x->'payload'->'_empresa'->>'cnpj',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(v_ok) as x where x->>'module' = 'handover'
  on conflict (unique_id) do update set
    content_hash = excluded.content_hash, payload = excluded.payload, photos = excluded.photos,
    poco = excluded.poco, report_date = excluded.report_date, cliente = excluded.cliente, contrato = excluded.contrato,
    empresa_nome = excluded.empresa_nome, empresa_cnpj = excluded.empresa_cnpj, device_id = excluded.device_id,
    user_id = excluded.user_id, user_email = excluded.user_email, updated_at = now()
  where (execution_reports.user_id = excluded.user_id and execution_reports.content_hash is distinct from excluded.content_hash)
     or (execution_reports.user_id is null and v_email is not null and lower(execution_reports.user_email) = lower(v_email));

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

revoke all on function public.submit_reports(jsonb) from public, anon;
grant execute on function public.submit_reports(jsonb) to authenticated;

-- 007: contrato do BDO-e ligado à licença do Painel de Licenças (projeto winappos-licensing).
-- A Edge Function provisionar-gestor (no projeto de licenças) cria o contrato com license_id, o gestor
-- (contract_members role = gestor, conta com must_change_password) e mantém max_technicians/ativo iguais à licença.
alter table public.contracts add column if not exists license_id uuid;
create unique index if not exists contracts_license_id_key on public.contracts (license_id) where license_id is not null;
comment on column public.contracts.license_id is 'ID da licença no painel WinApp licença (projeto winappos-licensin)';

-- 008: o GESTOR do contrato redefine a senha de um técnico (Edge Function reset-technician-password).
-- Esta função só CONFERE e devolve quem é o técnico; a senha nova é gravada pela Edge Function com a chave de
-- serviço (senha provisória + must_change_password: o técnico cria uma senha própria no próximo acesso).
-- Regras: só o gestor ativo do contrato; só técnico ATIVO; nunca um gestor; e não vale para quem tem acesso a
-- outro contrato que este gestor não gere (senão um gestor entraria nos dados de outro contrato) — esses casos
-- ficam com o Master da licença.
create or replace function public.team_reset_password_target(p_member_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = public
as $$
declare
  m public.contract_members;
  v_user uuid;
begin
  select * into m from public.contract_members where id = p_member_id;
  if not found or not public._pode_gerir(m.contrato_id) then
    raise exception 'Sem permissão para redefinir esta senha.' using errcode = '42501';
  end if;
  if m.role <> 'tecnico' then
    raise exception 'A senha de gestores é redefinida pelo Master da licença.' using errcode = '42501';
  end if;
  if not m.ativo then
    raise exception 'Reative o acesso antes de gerar uma nova senha.' using errcode = '22023';
  end if;
  if exists (select 1 from public.contract_members o
             where o.email = m.email and o.id <> m.id
               and (o.role = 'gestor' or (o.ativo and not public._pode_gerir(o.contrato_id)))) then
    raise exception 'Este técnico também tem acesso a outro contrato. Peça ao Master da licença para redefinir a senha.'
      using errcode = '42501';
  end if;
  v_user := coalesce(m.user_id, (select u.id from auth.users u where lower(u.email) = m.email limit 1));
  if v_user is null then
    raise exception 'Este técnico ainda não tem conta no servidor.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('user_id', v_user, 'email', m.email, 'nome', m.nome, 'matricula', m.matricula, 'contrato', m.contrato);
end;
$$;

revoke all on function public.team_reset_password_target(uuid) from public, anon;
grant execute on function public.team_reset_password_target(uuid) to authenticated;

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
