// Valores da publicação do site (PWA). No repositório ficam VAZIOS; o `npm run build` (Cloudflare Pages)
// grava a cópia em dist/src/env.js com as variáveis de ambiente do projeto:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (chave anon/publishable — nunca a service_role)
//   NEXT_PUBLIC_APP_URL (endereço oficial do app, ex.: https://bdo.winappdigital.com.br)
// O app desktop e o uso local continuam pelas Configurações / variáveis BDOE_* (ver src/config.js).
export const ENV = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  appUrl: ''
};
