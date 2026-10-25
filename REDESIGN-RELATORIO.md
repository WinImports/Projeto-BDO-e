# Redesign do BDO-e — versão 2.1.0

Acabamento visual e de experiência para deixar o app com cara profissional e empresarial,
sem mudar regra de negócio, formulário, dados ou envio. Nenhuma funcionalidade foi removida.

## Identidade visual (inspeção + petróleo e gás)

- **Cor principal: Azul Petróleo `#002B49`**, a mesma da faixa do PDF. App, PDFs (BDO-e, Visita, Execução) e Word agora usam a mesma cor (antes o app era `#0b5cad`).
- **Destaque: laranja de segurança industrial `#E87722`**, usado com moderação: aba ativa, linha do topo no tema escuro, faixa abaixo do cabeçalho do PDF e o título pequeno das páginas.
- **Fonte Barlow** embutida no app (`src/fonts/`, licença OFL): igual no Windows, Android e iPhone e funciona sem internet.
- **Novo ícone**: cabeça de poço (árvore de natal com válvulas e flange) com uma lupa de inspeção laranja e o sinal de conferido. Gerados a partir de `icons/logo.svg`: ícones do PWA (192, 512 e "maskable") e `icons/icon.ico` para o instalador do Windows.

## Etapa 1: termos técnicos fora da vista do técnico

- Configurações: a parte "Servidor (Supabase)" foi para **"Avançado (administrador)"**, uma área recolhida no fim da página, com os mesmos campos.
- Saíram de todos os textos visíveis as palavras "Supabase" e "IndexedDB". Agora aparece "servidor da empresa" e "memória local deste aparelho".
- Login: saiu o aviso amarelo "Servidor não configurado"; ficou uma linha discreta em cinza.

## Etapa 2: menos alertas amarelos

- "N pendentes" (índice lateral e seções) e "Faltam N campos" ficam em **cinza** enquanto o técnico preenche. Só ganham cor de atenção depois de uma tentativa de "Salvar e Finalizar" com campos faltando.
- "Empresa não configurada" virou um chip discreto, sem fundo amarelo e sem borda tracejada.
- "Nenhum contrato vinculado…" passou a ser texto de ajuda em cinza.
- Status do topo: "Local" / "Online" / "Sem conexão" / "Sincronizando", com a explicação ao passar o mouse.
- "Sincronizar agora" desabilitado agora aparece em cinza e explica o motivo.

## Etapa 3: celular

- Topo em **uma linha**: logo + "BDO-e" + ícone do usuário + status + tema.
- **Barra de navegação inferior** com ícone e nome: BDO-e, Visita, Execução, Histórico, Ajustes (e Equipe, para o gestor). Sem o espaço vazio de antes. O contador do Histórico fica sobre o ícone.
- A barra "Prévia / Salvar e Finalizar" fica logo acima da navegação.
- Cartão do título compacto: sem o título repetido, chips numa linha e barra de progresso fina. O primeiro campo aparece na primeira tela.
- No computador, o título pequeno repetido também saiu (no BDO-e ele dizia o mesmo que o título).

## Etapa 4: telas de acesso

- Login, ativação de licença e troca de senha com o mesmo visual:
  - **No computador**: painel em Azul Petróleo com o logo, a descrição do app e três destaques sobre um quadriculado técnico discreto.
  - **No celular**: logo no topo e formulário em tela cheia.
- Botão **mostrar/ocultar senha**.
- **"Esqueci minha senha"**: mostra a orientação de falar com o gestor do contrato ou com o administrador (ver decisões).
- Versão do app no rodapé (2.1.0).

## Etapa 5: PDF do BDO-e

- **Bloco de assinaturas** no fim da página:
  - "Técnico responsável", já com nome e matrícula.
  - "Fiscal / representante do cliente", com o nome a preencher.
  - Cada um com linha de assinatura e "Data: __/__/____".
- Um turno cheio, com até 20 atividades longas, continua cabendo em **1 página**. Para isso foi acrescentado mais um nível de redução automática.
- Cabeçalho das tabelas em faixa sólida, **sem as divisórias brancas**.
- Rodapé: "Gerado pelo BDO-e em …".
- A logo da empresa do contrato já aparecia na faixa do cabeçalho quando cadastrada; isso foi mantido.

## Etapa 6: detalhes finais

- No computador, a barra fixa inferior agora tem a largura da coluna de conteúdo e não cobre o fim do formulário. O mesmo vale para Configurações.
- Contraste conferido nos dois temas (texto ≥ 4.5:1). O laranja do título pequeno foi escurecido para passar.
- Abas com nome acessível (leitor de tela), também no celular.
- Histórico vazio com o novo visual.

## Decisões tomadas sozinho (conferir)

1. **"Esqueci minha senha" não envia e-mail.** O app não tem a tela que recebe o link de redefinição do servidor. Enviar o e-mail levaria o técnico a uma tela que não funciona. Por isso o link orienta a falar com o gestor ou o administrador. Para ter redefinição por e-mail é preciso criar essa tela: fica como próximo passo.
2. **Pendências ficam em cor de atenção só após tentar finalizar**, não ao sair de cada campo. É mais simples e evita alerta enquanto o técnico ainda está preenchendo.
3. **Assinaturas só no PDF do BDO-e.** Visita Técnica e Relatório de Execução já têm o campo de assinatura (desenhada ou imagem) no próprio formulário e no PDF/Word, então não foram alterados. O Word do BDO-e continua sem o bloco de assinaturas.
4. **Versão do app 2.0.0 → 2.1.0** (package.json e `APP_VERSAO` em `src/config.js`).

## Testes

`npm test` (Playwright + Electron real), na nuvem:

- **139 passaram**, 3 pulados (dependem de arquivos que só existem na sua máquina).
- **1 falhou por causa do ambiente, não do código:** `atualizacao-banco.spec.js` abre o Electron diretamente, sem o Playwright, e na nuvem o Electron se recusa a rodar como administrador (root). Esse teste já falhava do mesmo jeito antes das mudanças. No seu computador ele roda normalmente.
- **Corrigido de brinde:** o teste `mobile.spec.js` › "sem rolagem lateral" já falhava antes. A aba Execução tinha rolagem lateral no celular, e agora passa.
- **Testes atualizados de propósito:**
  - Os testes do servidor abrem "Avançado (administrador)" antes de preencher (`abrirAvancado` em helpers.js).
  - O texto do aviso de "só salvar" mudou.
  - O teste do tema escuro compara com a cor do tema, sem valor fixo.
- **Novo teste:** bloco de assinaturas do PDF.
