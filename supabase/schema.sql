-- =====================================================================
-- BDO-e & Inspeção Técnica — esquema Supabase
-- Execute no Supabase: SQL Editor → New query → cole e rode.
-- =====================================================================

-- 1) Tabela de relatórios ---------------------------------------------
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

-- 2) Gravação em lote, idempotente ------------------------------------
-- Recebe um array JSON de relatórios. Insere os novos e ignora unique_id já existentes.
-- Devolve (unique_id, id) de TODOS os itens do lote — inclusive os já gravados antes —
-- que é a confirmação explícita usada pelo app para liberar a caixa de saída.
create or replace function public.submit_reports(reports jsonb)
returns table (unique_id uuid, id bigint)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if jsonb_typeof(reports) <> 'array' then
    raise exception 'reports deve ser um array JSON';
  end if;
  if jsonb_array_length(reports) > 50 then
    raise exception 'lote acima de 50 relatórios';
  end if;

  insert into public.reports (unique_id, base, module, content_hash, payload, photos, client_created_at)
  select (x->>'unique_id')::uuid,
         x->>'base',
         x->>'module',
         x->>'content_hash',
         x->'payload',
         coalesce(x->'photos', '[]'::jsonb),
         (x->>'client_created_at')::timestamptz
  from jsonb_array_elements(reports) as x
  on conflict on constraint reports_unique_id_key do nothing;

  return query
    select r.unique_id, r.id
    from public.reports r
    where r.unique_id in (select (x->>'unique_id')::uuid from jsonb_array_elements(reports) as x);
end;
$$;

revoke all on function public.submit_reports(jsonb) from public;
grant execute on function public.submit_reports(jsonb) to anon, authenticated;

-- 3) Storage para fotos -----------------------------------------------
insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', false)
on conflict (id) do nothing;

-- Apenas envio (insert). Sem leitura/alteração/exclusão pela chave pública.
drop policy if exists "report-photos: upload" on storage.objects;
create policy "report-photos: upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'report-photos');

-- 4) Configurações por computador (empresa, contrato, técnico padrão) --
create table if not exists public.device_settings (
  device_id   uuid        primary key,
  settings    jsonb       not null,       -- inclui o logo (data URL redimensionado)
  updated_at  timestamptz not null,       -- horário da alteração no computador
  received_at timestamptz not null default now()
);

alter table public.device_settings enable row level security;

-- Upsert idempotente: só sobrescreve se a versão recebida for mais nova.
-- Devolve o device_id como confirmação explícita para o app.
create or replace function public.save_device_settings(p_device_id uuid, p_settings jsonb, p_updated_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.device_settings as d (device_id, settings, updated_at)
  values (p_device_id, p_settings, p_updated_at)
  on conflict (device_id) do update
    set settings = excluded.settings, updated_at = excluded.updated_at, received_at = now()
    where d.updated_at < excluded.updated_at;
  return p_device_id;
end;
$$;

revoke all on function public.save_device_settings(uuid, jsonb, timestamptz) from public;
grant execute on function public.save_device_settings(uuid, jsonb, timestamptz) to anon, authenticated;
