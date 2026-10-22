-- Simulação mínima do que o Supabase oferece (auth, storage e papéis), para rodar o supabase/schema.sql
-- num Postgres local (PGlite) nos testes. NÃO é para rodar no Supabase.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  encrypted_password text,
  banned_until       timestamptz,
  created_at         timestamptz not null default now()
);
-- Igual ao Supabase: as claims do JWT da requisição ficam em request.jwt.claims
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid;
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(auth.jwt()->>'role', 'anon');
$$;

create schema if not exists storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name      text not null,
  owner     uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Como no Supabase: tabelas novas do public ficam acessíveis aos papéis da API (o RLS é quem barra)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- pgcrypto (no Supabase fica no schema "extensions"): versão FALSA e barata só para os testes —
-- crypt(senha, hash) = 'h:' || senha; no banco real é bcrypt
create schema if not exists extensions;
create function extensions.gen_salt(tipo text, rodadas integer default 10) returns text language sql immutable as $$ select 'h:' $$;
create function extensions.crypt(senha text, sal text) returns text language sql immutable as $$ select 'h:' || senha $$;
grant usage on schema extensions to anon, authenticated, service_role;
