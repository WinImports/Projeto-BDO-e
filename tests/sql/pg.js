// Postgres local (PGlite) com o Supabase simulado + supabase/schema.sql, para testar o banco e as Edge
// Functions sem tocar no banco real. Usado por tests/banco.spec.js e tests/edge-functions.spec.js.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const ROOT = path.join(__dirname, '..', '..');
const STUB = fs.readFileSync(path.join(__dirname, 'supabase-stub.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
const DIR_MIG = path.join(ROOT, 'supabase', 'migrations');
const MIGRACOES = fs.readdirSync(DIR_MIG).filter((n) => n.endsWith('.sql')).sort().map((n) => fs.readFileSync(path.join(DIR_MIG, n), 'utf8'));
const MIGRACAO = MIGRACOES.join(String.fromCharCode(10)); // todas, em ordem (o que se roda no SQL Editor)
const ANTES = SCHEMA.slice(0, SCHEMA.indexOf(MIGRACOES[0])); // schema de antes das migrações (= produção hoje)

/** Banco novo. antigo: só o schema anterior (para testar a migração sobre dados existentes). */
async function novoBanco({ antigo = false } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(antigo ? ANTES : SCHEMA);
  return db;
}

/** Usuário do Supabase Auth (e-mail confirmado por padrão). Devolve o id. */
async function usuario(db, email, { confirmado = true } = {}) {
  const r = await db.query('insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id', [email, confirmado ? new Date() : null]);
  return r.rows[0].id;
}

/** Executa fn com a identidade de uma requisição da API: { id, email } logado, 'anon' ou 'service'. */
async function como(db, quem, fn) {
  const claims = quem === 'anon' ? { role: 'anon' } : quem === 'service' ? { role: 'service_role' } : { sub: quem.id, email: quem.email, role: 'authenticated' };
  const papel = quem === 'anon' ? 'anon' : quem === 'service' ? 'service_role' : 'authenticated';
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${papel}`);
  try { return await fn(); } finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims', '', false)"); }
}

const rpc = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const um = async (db, sql, params = []) => (await rpc(db, sql, params))[0];
const erro = async (p) => { try { await p; return null; } catch (e) { return e; } };

/** Cenário: contratos A (cota 2) e B, gestores e técnicos. Cota e gestores: só o dono, por SQL. */
async function cenario() {
  const db = await novoBanco();
  const ids = {};
  for (const [k, email] of Object.entries({ gestorA: 'gestor.a@empresa-a.com', gestorB: 'gestor.b@empresa-b.com', tec1: 'tec1@empresa-a.com', tecB: 'tecb@empresa-b.com' })) {
    ids[k] = { id: await usuario(db, email), email };
  }
  const A = (await um(db, "insert into public.contracts (nome) values ('OS-Mans') returning id")).id;
  const B = (await um(db, "insert into public.contracts (nome, max_technicians) values ('Contrato Bahia Terra', 5) returning id")).id;
  await db.query(`insert into public.contract_members (email, contrato_id, role, nome, matricula) values
    ('gestor.a@empresa-a.com', $1, 'gestor', 'Gestor A', 'G-001'),
    ('tec1@empresa-a.com', $1, 'tecnico', 'Técnico Um', 'T-001'),
    ('gestor.b@empresa-b.com', $2, 'gestor', 'Gestor B', 'G-002'),
    ('tecb@empresa-b.com', $2, 'tecnico', 'Técnico B', 'T-900')`, [A, B]);
  return { db, A, B, ...ids };
}

module.exports = { ROOT, SCHEMA, MIGRACOES, MIGRACAO, ANTES, novoBanco, usuario, como, rpc, um, erro, cenario };
