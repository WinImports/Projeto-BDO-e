# BDO-e & Inspeção Técnica

App desktop (Electron) para relatórios de campo de inspeção de poços, manutenção de cabeça de poço/válvulas, leitura de pressões e intervenção de superfície sem sonda. Offline-first com envio ao Supabase.

## Executar e testar

- `npm start` → `electron .` (carrega `./index.html` via `file://`; **não há servidor web, bundler, React ou TypeScript**).
- **PWA / GitHub Pages**: a MESMA `./index.html` roda no navegador/celular (caminhos sempre relativos `./`). `src/core/platform.js` escolhe Electron (`window.desktop`) ou web (base de poços em localStorage/fetch, PDF via janela de impressão com CSS por CSSOM). **Antes de publicar rode `npm run pwa`**: atualiza VERSION e a lista offline do `sw.js` e roda o `npm test` (`npm run pwa:sw` só atualiza). O hook `.githooks/pre-push` (ativado por `npm install` via `prepare` → `core.hooksPath`) **bloqueia o push** se o `sw.js` estiver desatualizado.
- **Celular**: alvos de toque ≥ 44 px e inputs de 16 px (evita zoom do iOS) em `@media (pointer: coarse), (max-width: 640px)`; datas/horas sempre `date`/`time`/`datetime-local`. Elementos `position:absolute` dentro de áreas roláveis precisam de ancestral `position: relative` (senão vazam e criam rolagem lateral — ver `.table-wrap`). Teste: `tests/mobile.spec.js` (janela 390 px).
- `npm test` → Playwright abrindo o Electron real (`tests/`). Dados de teste ficam isolados via `BDOE_USER_DATA`.
- `npm install` roda `postinstall` que baixa o binário do Electron (o npm desta máquina bloqueia scripts de pacotes).
- Se `npm start` falhar com `reading 'whenReady'`: a variável `ELECTRON_RUN_AS_NODE` está definida (o VS Code injeta). Remova-a antes.

## Arquitetura

```
main.js          processo principal: janela, permissões (só câmera e GPS), IPC pdf:save (printToPDF)
electron/        IPC e parser da base de poços (CSV/KML)
preload.js       contextBridge → window.desktop (savePdf). contextIsolation + sandbox ligados
index.html       página única (Electron + PWA). CSP restrita: scripts só locais; connect-src *.supabase.co; frame-src openstreetmap.org
manifest.json, sw.js, icons/, .nojekyll   PWA (sw.js gerado por scripts/gerar-pwa.js)
src/vendor/      supabase.js (UMD copiado de node_modules: `npm run vendor`)
src/shared/      pocos-parser.js — UMD usado pelo Electron, navegador, script e testes
src/app.js       orquestração: base/abas, layout do formulário, índice de seções, ações, Ctrl+S
src/config.js    SUPABASE_URL / SUPABASE_ANON_KEY e parâmetros de sync (vazio = "Somente local")
src/core/        db (IndexedDB), drafts, outbox, sync, supabase, settings, ids, prefs
src/modules/     definições DECLARATIVAS dos formulários (visita-tecnica, bdo, handover, common)
src/ui/          form (renderizador), preview, report-pdf, outbox-view, settings-view, camera, icons, toast
supabase/schema.sql  tabelas, RPCs e Storage (rodar no SQL Editor do Supabase)
_legado/         versão antiga — não editar
```

Supabase JS é carregado do **build UMD local** (`src/vendor/supabase.js`, cópia de node_modules) e usado via `window.supabase` em `src/core/supabase.js`. Não importar de CDN.

**Publicação**: repositório público `WinImports/Projeto-BDO-e` com GitHub Pages. A base REAL de poços (`src/data/pocos-ba.json`, CSV/KML) **nunca vai para o Git** (.gitignore) — dados operacionais; no celular a base é importada em Configurações.

## Regras de negócio

- Menu com exatamente 3 relatórios, nesta ordem (`src/modules/index.js`): **BDO-e** (`bdo`), **Relatório de Visita Técnica** (`visita_tecnica`), **Relatório de Execução** (`handover`). Não existe mais seleção de base BA/SE; rascunhos são um por relatório (chave = id do módulo; chaves antigas `BA:x`/`SE:x` são migradas em `core/drafts.js`). A coluna `base` no banco ficou só como legado (nula).
- **Base de poços/locações**: importada pelo usuário em Configurações (arrastar ou escolher `.csv`/`.kml`). O parser (`src/shared/pocos-parser.js`) roda no processo principal no desktop e no próprio navegador no PWA e grava `userData/pocos-base.json` de forma atômica; IPC em `electron/pocos.js` (`pocos:list|status|import|clear`). Prioridade: base importada → base embutida `src/data/pocos-ba.json` (`BDOE_POCOS_FILE` nos testes) → vazia. O campo Poço/Locação (`autocomplete: 'pocos'`) sugere poços (exato → sem zeros à esquerda → contém) e, ao escolher, preenche as coordenadas (`source: 'base'`); coordenadas de GPS/digitadas só são trocadas com confirmação. Arquivo inválido nunca substitui a base atual. Importação com mais da metade dos pontos fora da BA/SE é recusada (lat/lng trocadas ou UTM). A base embutida atual é a real da UO-BA (6.421 poços, gerada de `pocos_UO-BA_verificacao.csv`; o KML equivalente bate 100%). Ao sair do campo Poço com nome exato, só preenche coordenadas se o foco não foi para Latitude/Longitude e elas estiverem vazias. Testes usam bases fictícias em `tests/fixtures/`.
- **Histórico local** (IndexedDB `history`, DB v2): todo relatório finalizado é copiado **com as fotos** ao entrar na Caixa de Saída e **fica no aparelho mesmo após o envio** (`sentAt` gravado em `confirmDelivered`); "Editar" remove e o reenvio regrava. Na atualização v1→v2 o conteúdo da fila é copiado (teste em `tests/atualizacao-banco.spec.js`). Registros antigos sem fotos guardadas avisam na prévia.
- **Aba Histórico** (id `outbox`, `src/ui/outbox-view.js` + `outbox.reports()`): lista histórico ∪ fila com tipo, poço, data do relatório e status (Aguardando envio / Reagendado / Enviado), filtro por tipo. Tocar abre a prévia `mode: 'view'` com "Gerar PDF / Imprimir" e "Reutilizar / Editar como novo" (novo rascunho com NOVO uniqueId; não copia data/hora, fotos, assinatura nem consolidação). A prévia tem barra `.modal__nav` no topo: "Voltar e editar" e "Início / Novo relatório" (`onNewReport`, apaga o rascunho com confirmação). Testes: `tests/historico.spec.js`.
- **Consolidação 14x14** (Relatório de Execução): campo `type: 'consolidation'` + `src/core/consolidar.js`. Com Poço/Locação + início/fim da quinzena (padrão: últimos 14 dias), agrupa automaticamente os BDOs do poço no período (atividades e horas, paradas, SMS/RPT) e o último status de equipamentos da Visita Técnica do poço. O resultado é congelado no relatório ao finalizar; é refeito ao abrir a aba e pelo botão "Atualizar consolidação". No PDF fica fora da grade de campos (`.preview__consol`) para paginar bem; partes vazias não aparecem.
- Os 3 relatórios têm **Coordenadas GPS** (`coordenadas()`, tipo `geo`) no bloco de identificação, **somente leitura**: vêm só do botão "Obter Localização Atual" ou do poço escolhido na base (não há digitação; "Limpar" apaga). No PDF/prévia elas vão para o **cabeçalho** (`geoHeaderHtml`) com links clicáveis e não se repetem no corpo.
- **Rotas** (`src/ui/route-prompt.js`): links de NAVEGAÇÃO com o poço como **destino** (`maps/dir/?api=1&destination=lat,lng`, Waze `navigate=yes`); o destino é o poço da base pelo nome do cabeçalho, e só sem cadastro usa as coordenadas do relatório. Gatilhos com aviso discreto `.route-prompt`: (1) ao escolher/digitar um poço da base (uma vez por poço na tela); (2) coluna com `routeTrigger` (atividade do BDO) contendo deslocamento/mobilização (`isTravel`, uma vez por linha). O aviso fecha ao trocar de aba. Testes: `tests/rotas.spec.js`.
- **BDO** não tem fotos (apropriação de horas, paradas, materiais, SMS) e não deve ser alterado pelas regras abaixo.
- **Visita Técnica e Execução** seguem a sequência cronológica do modelo Word oficial: cabeçalho (com parágrafo de abertura gerado por `paragrafoAbertura()`) → chegada ao poço (placa e árvore de natal) → pressões e manômetros → um bloco por componente (Antipoço, VC, VA-1, VA-2, VB-1, VB-2, flange superior, flange inferior — listas `ANTEPOCO`/`VALVULAS_CABECA`/`FLANGES` em `modules/common.js`) → outras fotos → recomendações e assinatura.
- **Fotos por componente** (`src/core/fotos.js`): cada componente tem seu campo `photos` (`fotos_<p>`, mesmos ids nos dois relatórios); cada foto guarda `field`, `legenda`, `fase` ('antes'|'depois') e `origem` (`photoMeta()` em fila, histórico, rascunho e envio). Fotos antigas sem `field` vão para "Outras fotos" (`assignPhotoFields`). No PDF ficam logo abaixo do componente como "Figura N — legenda", numeradas na ordem do relatório.
- **Antes x Depois** (Execução, campos `compare: true`): ao consolidar, `FormView.importBefore()` copia as fotos da última Visita Técnica do poço (histórico) para a coluna "Antes" de cada componente (`data._visita_ref/_visita_data`); só refaz se a Visita de referência mudar.
- Relatórios no formato anterior (tabelas `valvulas`/`fixadores`) seguem completos na prévia/PDF pela seção `legacy: true` (oculta no formulário); a consolidação lê os dois formatos.
- **PDF compacto**: campos, colunas e seções sem dados não são impressos; a prévia avisa os blocos vazios.
- Relatórios novos recebem padrões das **Configurações** (`settingsKey` nos campos). Empresa/logo são congelados em `data._empresa` ao finalizar.

## Regras de dados (não quebrar)

1. **Outbox**: todo relatório finalizado é gravado no IndexedDB **antes** de qualquer rede (`core/outbox.js`). Rascunhos também ficam no IndexedDB (fotos são Blobs).
2. **Trava de confirmação**: item só sai da fila com HTTP 200/201 **e** `id` devolvido para o `unique_id` (`core/sync.js`).
3. **Idempotência**: `uniqueId` (UUID) nasce com o rascunho e é a chave única no banco; reenviar nunca duplica.
4. **Escrita só por RPC** `security definer` (`submit_reports`, `save_device_settings`). RLS ligado e sem políticas para `anon` nas tabelas. Storage: bucket privado `report-photos`, só INSERT.
5. Backoff: 3 tentativas imediatas, depois 30s → 15min com jitter. Fotos já enviadas não são reenviadas.
6. Mudou o esquema? Atualize `supabase/schema.sql` de forma idempotente (`if not exists`, `create or replace`).

## Convenções de código

- JavaScript ES modules puro (sem TS, sem framework). Interface em português; código e nomes de campos em português sem acento (`poco`, `km_inicial`).
- **Formulários são dados**: para incluir/alterar campos edite `src/modules/*.js`; não escreva HTML de formulário à mão. Tipos e propriedades documentados no topo de `src/modules/common.js` (`span`, `divider`, `table` com `presetRows`/`computed`/`aux`, `geo`, `photos`, `signature`, `highlight`, `settingsKey`).
- Sempre escapar texto dinâmico com `esc()` (`src/ui/dom.js`). Sem `style=""` inline (CSP); use classes ou `el.style` via JS.
- Ícones: `icon(nome)` de `src/ui/icons.js` (SVG). Não usar emoji na interface.
- Nunca usar `alert/confirm/prompt` nativos: use `confirmDialog()` (`src/ui/confirm.js`) e `toast(msg, 'success'|'error'|'info'|'warn')`.
- Editar item da Caixa de Saída só se `canEdit(rec)` (nunca houve tentativa de envio); `rehydrate()` reconstrói tabelas com linhas fixas.
- Em scripts de edição com `String.replace`, cuidado: `$$` na string de substituição vira `$` (use `split/join`).
- Testes E2E em `tests/` (Playwright + Electron real). Rode `npm test` antes de concluir mudanças de interface. Use `openTab(page, id)` (espera `#view[data-ready=id]`) em vez de clicar na aba direto.
- Cores e espaçamentos via tokens CSS em `src/styles.css` (`--primary`, `--surface`…), com tema claro/escuro.
- Datas exibidas em pt-BR; datas de arquivo usam data local (nunca `toISOString()` para "hoje").
