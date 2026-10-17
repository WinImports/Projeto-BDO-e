# BDO-e & Inspeção Técnica

Aplicativo desktop (Electron) para inspeção técnica de poços, manutenção de equipamentos de cabeça de poço, válvulas, leitura de pressões e intervenções de superfície sem sonda. Funciona **offline-first**: tudo é gravado no computador e enviado ao Supabase quando houver conexão.

## Executar

```bash
npm install     # instala dependências (e baixa o binário do Electron via postinstall)
npm start       # abre o app (electron .) — sem servidor web
```

> Se aparecer `Cannot read properties of undefined (reading 'whenReady')`, a variável `ELECTRON_RUN_AS_NODE` está definida no terminal (o VS Code a injeta em alguns processos). Rode `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell) ou `unset ELECTRON_RUN_AS_NODE` (bash) antes do `npm start`.

## Funcionalidades

- **Barra de ações fixa** em todos os formulários: *Salvar Rascunho* (no computador, sem rede), *Prévia do PDF / Conferência* (a qualquer momento, avisando campos pendentes) e *Finalizar e Enviar para Caixa de Saída*. O rascunho também é salvo automaticamente a cada alteração.
- **PDF**: botão *Salvar PDF* na prévia gera um A4 com cabeçalho, ID único, coordenadas e fotos (`ui/report-pdf.js` + `pdf:save` no `main.js`). Rascunhos saem marcados como "RASCUNHO". O PDF é compacto: campos, colunas e blocos sem dados não são impressos, e a prévia avisa quais blocos opcionais ficaram vazios.
- **Geolocalização**: botão *Capturar Coordenadas GPS da Locação* (serviço de localização do Windows / receptor GPS), edição manual, mini mapa OpenStreetMap (online) e links para Google Maps, Waze e OpenStreetMap. Requer a Localização ativada em *Configurações do Windows › Privacidade › Localização*.
- **Configurações do Sistema** (aba ⚙): empresa prestadora (nome, CNPJ validado, logo), cliente/contrato padrão e técnico padrão (nome, matrícula, cargo). Salvas no `localStorage` na hora e enviadas ao Supabase (`save_device_settings`) pela rotina de sincronização. Relatórios novos já nascem preenchidos (propriedade `settingsKey` nos campos dos módulos); empresa e logo são congelados no relatório ao finalizar.
- **Links de mapa clicáveis** na tela e no PDF (coordenada → Google Maps; e Waze / OpenStreetMap).
- **Câmera** e **assinatura** na tela; fotos organizadas por categoria (Visita e Pós-Execução — o BDO não tem fotos).
- **BDO**: cabeçalho com cliente, contrato, poço, cidade/UF, técnico e matrícula, operador, gestor, atividade principal, KM inicial/final (KM percorrido calculado) e GPS; apropriação com data/hora de início e fim e duração calculada (inclusive virando o dia).

## PWA (celular) / GitHub Pages

A mesma página (`./index.html`) roda no navegador: instale pelo menu do Chrome/Safari → "Adicionar à tela inicial". Funciona offline (Service Worker `sw.js`) e se atualiza sozinha quando uma versão nova é publicada. No navegador, o PDF abre na janela de impressão ("Salvar como PDF") e a base de poços é importada em Configurações (a base real não é publicada).

Antes de cada publicação: `npm run pwa` (atualiza a versão e a lista de arquivos offline) e `npm test`.

## Configurar o Supabase

1. No painel do Supabase, abra **SQL Editor** e execute [`supabase/schema.sql`](supabase/schema.sql). Ele cria:
   - tabela `reports` (com `unique_id` único e RLS ligado),
   - função `submit_reports` (gravação em lote idempotente),
   - bucket privado `report-photos` (somente upload),
   - tabela `device_settings` e função `save_device_settings` (configurações de cada computador).
2. Preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` em [`src/config.js`](src/config.js).

Sem configuração, o app funciona normalmente e mantém os relatórios na Caixa de Saída ("Somente local").

## Relatórios

Três abas, nesta ordem: **BDO-e** (Boletim Diário Operacional Eletrônico), **Relatório de Visita Técnica** e **Relatório de Execução**. Todos têm Coordenadas GPS no cabeçalho (botão *Obter Localização Atual* ou digitação manual), impressas no topo do PDF com links clicáveis.

## Fluxo de dados

```
Formulário ──(cada alteração)──► Rascunho (IndexedDB)
    │
    └─ Revisar e salvar ─► Prévia/Conferência ─► Caixa de Saída (IndexedDB)
                                                      │
                     online + Supabase configurado ───┘
                                                      ▼
                        1. fotos → Storage (caminho fixo por uniqueId)
                        2. lote → rpc submit_reports
                        3. HTTP 200/201 + id devolvido? → remove da fila
                           senão → backoff e nova tentativa
```

- **uniqueId** (UUID) nasce com o rascunho e acompanha o relatório até o banco. Reenvios nunca duplicam: o banco ignora `unique_id` repetido e devolve o id já existente.
- **Retry**: 3 tentativas imediatas (1s, 2s, 4s); depois o item é reagendado em 30s, 1min, 2min… até 15min (com jitter). Também sincroniza ao voltar a conexão e a cada 30s.
- **Trava de confirmação**: o item só sai da fila se a resposta trouxer status 200/201 **e** o `id` para aquele `unique_id`.
- Fotos já enviadas são marcadas e não são reenviadas em novas tentativas.

## Estrutura

```
main.js                 processo principal do Electron (janela, segurança)
preload.js              ponte segura (contextBridge)
supabase/schema.sql     banco, função de gravação e Storage
src/
  index.html, styles.css, app.js   interface e orquestração
  config.js             credenciais Supabase e parâmetros de sync
  core/                 db (IndexedDB), drafts, outbox, sync, supabase, ids, prefs
  modules/              definições declarativas dos formulários (um arquivo por módulo)
  ui/                   renderizador de formulário, prévia, caixa de saída, toasts
_legado/                versão anterior do projeto (referência)
```

### Adicionar ou alterar campos

Edite o arquivo do módulo em `src/modules/` (ex.: lista de válvulas em `visita-tecnica.js`). Tipos suportados: `text`, `number`, `date`, `time`, `datetime`, `select`, `textarea`, `checklist`, `yesno`, `table`, `photos`, `signature` — a referência completa das propriedades está no topo de `src/modules/common.js`.

- **Tabelas com linhas pré-definidas** (`presetRows`): usadas para válvulas, prisioneiros, pressões e correções. A coluna `locked` fica fixa; linhas sem nenhum valor preenchido não são salvas.
- **Fotos por categoria** (`categories`): cada categoria tem botões *Arquivo* e *Câmera*. A câmera prefere uma webcam física (ignora NDI/OBS) e lembra a última escolhida.
- **Validações extras**: função opcional `validate(data, { filled })` do módulo (ver `handover.js`).

## Segurança — próximo passo recomendado

Hoje qualquer pessoa com a chave pública pode **enviar** relatórios (não pode ler, alterar nem apagar). Para produção, adicione login (Supabase Auth), troque `anon` por `authenticated` nas permissões do `schema.sql` e grave o usuário em cada relatório.
