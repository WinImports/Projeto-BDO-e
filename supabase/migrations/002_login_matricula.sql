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
