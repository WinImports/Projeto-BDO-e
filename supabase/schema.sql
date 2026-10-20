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

  insert into public.bdo_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(reports) as x where x->>'module' = 'bdo'
  on conflict (unique_id) do nothing;

  insert into public.technical_visits (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
         v_uid, coalesce(v_email, x->>'user_email'), nullif(x->>'device_id', '')::uuid, (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(reports) as x where x->>'module' = 'visita_tecnica'
  on conflict (unique_id) do nothing;

  insert into public.execution_reports (unique_id, content_hash, payload, photos, poco, report_date, cliente, contrato, user_id, user_email, device_id, client_created_at)
  select (x->>'unique_id')::uuid, x->>'content_hash', x->'payload', coalesce(x->'photos', '[]'::jsonb),
         x->'payload'->>'poco', public._report_date(x->'payload'), x->'payload'->>'cliente', x->'payload'->>'contrato',
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
-- Bucket PÚBLICO só para leitura por URL direta: o caminho é <módulo>/<uniqueId>.pdf|html (UUID, não
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
