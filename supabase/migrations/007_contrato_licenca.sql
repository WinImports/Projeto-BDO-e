-- 007: contrato do BDO-e ligado à licença do Painel de Licenças (projeto winappos-licensing).
-- A Edge Function provisionar-gestor (no projeto de licenças) cria o contrato com license_id, o gestor
-- (contract_members role = gestor, conta com must_change_password) e mantém max_technicians/ativo iguais à licença.
alter table public.contracts add column if not exists license_id uuid;
create unique index if not exists contracts_license_id_key on public.contracts (license_id) where license_id is not null;
comment on column public.contracts.license_id is 'ID da licença no painel WinApp licença (projeto winappos-licensin)';
