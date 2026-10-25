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
