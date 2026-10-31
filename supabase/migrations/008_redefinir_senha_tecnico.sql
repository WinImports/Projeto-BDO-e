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
