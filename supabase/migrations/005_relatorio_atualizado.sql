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
