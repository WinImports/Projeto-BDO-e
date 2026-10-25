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
