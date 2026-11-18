# Gerador de Story online — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar o Gerador de Story do PC (Node em `localhost:3333`) e colocá-lo em `gerador-de-story.pages.dev`, com login Google, no mesmo modelo do Gerador de Post, sem mudar a arte.

**Architecture:** Site estático em `web/` (Cloudflare Pages) + Apps Script novo em `src/` como API JSON (`login`, `sair`, `info`, `img`), copiado e reduzido do Post. A geração de cenário com IA sai do `server.js` e vai para `web/ia.js`, chamada direto do navegador com a chave guardada no aparelho. O `public/index.html` atual vira `web/index.html`, trocando as rotas `/api/*` pelo Apps Script e ganhando a tela de login do Post.

**Tech Stack:** Google Apps Script (V8), HTML/JS sem build, Google Identity Services, Pollinations / Gemini / OpenAI pelo navegador, testes `node --test` com os fakes do Post (`test/helpers/load-gs.js`, `test/helpers/gas-stubs.js`).

**Spec:** `docs/superpowers/specs/2026-11-18-story-online-design.md`

**Projeto irmão (fonte das cópias):** `C:\Users\User\Downloads\GERADORES\Gerador de Post` — só leitura, nunca alterar.

## Global Constraints

- Nenhum segredo no repositório (será público). O Google Client ID é público e pode ir no código; chaves de IA nunca.
- Propriedades do script: `GOOGLE_CLIENT_ID`, `PLANILHA_ID`. Nada mais.
- Planilha: aba `Clientes`, colunas A `email`, B `nome`, C `ativo`, linha 1 = cabeçalho.
- `MAX_SESSOES_POR_CLIENTE_ = 3`.
- Chaves do `localStorage` novas: `gs_sessao`, `gs_nome`. As que já existem continuam com o mesmo nome: `larAchadinhosIA` (IA), `larAchadinhosSettings` (campos salvos), `larAchadinhosLogo` (logo).
- Códigos de erro do servidor: `login`, `sem_acesso`, `sessao`, `acao`, `host`, `link_curto`, `rede`.
- Pedidos ao Apps Script: `POST` com corpo JSON em `text/plain` (sem `Content-Type`, sem preflight); sessão no corpo, nunca na URL.
- Chave de IA vai só no cabeçalho (`Authorization: Bearer` ou `x-goog-api-key`), nunca na URL e nunca em pedidos para `API_URL`.
- Hosts aceitos em `info`: `mercadolivre.com.br`, `produto.mercadolivre.com.br`, `mercadolivre.com`, `mercadolibre.com`, `meli.la`. Em `img`: `mlstatic.com`, `mercadolivre.com.br`, `mercadolibre.com`.
- Origens do cliente OAuth: `https://gerador-de-story.pages.dev`, `http://localhost:8765`.
- A arte (`draw()` e tudo que ele chama) não muda: mesma saída, pixel a pixel, para as mesmas entradas.
- Textos da interface em português do Brasil.
- `node --test` precisa passar sempre (o Cloudflare Pages roda isso antes de publicar).
- Commit: só quando o dono pedir. Ao fim de cada task, listar os arquivos prontos e perguntar; nunca dar push sem pedido explícito.

## Review Focus

1. Link que não é do Mercado Livre (Shopee, Amazon, texto qualquer): `info` devolve `host` e a página mostra "Esse link não é do Mercado Livre", sem travar o botão. (Task 4 testa o servidor; Task 7 mapeia a mensagem.)
2. Produto sem desconto (sem `previous_price`, ou `previous_price` ≤ preço): `precoAntigo` sai `null` e a arte não mostra "de R$" nem selo. (Task 2.)
3. Link curto que cai na tela de login do ML com `?go=<destino>`: o servidor segue o `go` e lê a página certa. (Task 4.)
4. IA sem vaga (402/429 com "retry after 31s") ou chave recusada (401/403): espera e tenta de novo até 4 vezes; chave recusada dá mensagem clara na hora; o botão volta a ficar ativo. (Task 6.)
5. Quarto aparelho entrando, ou dono desativado na planilha com a página aberta: o próximo `info`/`img` devolve `sessao`/`sem_acesso`, a página volta para o login com aviso e sem laço de recarga. (Tasks 3, 4 e 7.)

---

### Task 1: Repositório e base de testes

**Files:**
- Create: `.gitignore` (substitui o atual), `test/helpers/load-gs.js`, `test/helpers/gas-stubs.js` (cópias exatas do Post)
- Create: `.claude/launch.json` (configuração `web`: `python -m http.server 8765 --directory web`, porta 8765; manter a `gerador` antiga até a Task 8)

**Interfaces:**
- Produces: `loadGs(files, globals)` e `plain(v)` de `test/helpers/load-gs.js`; `makeStubs({props, respostas, clientes})` de `test/helpers/gas-stubs.js` (mesma interface do Post: `respostas` é uma fila de `{code, body, headers}` consumida por `UrlFetchApp.fetch`; `chamadas` registra `urls`, `opcoes`, `cachePut`).

- [ ] **Step 1:** `git init` na pasta `Gerador de Story`, branch `main`.
- [ ] **Step 2:** `.gitignore` com: `node_modules/`, `config.json`, `test/fixtures/real/`, `.superpowers/`, `*.log`. (`.claude/` deixa de ser ignorada para o `launch.json` ir junto, como no Post.)
- [ ] **Step 3:** Copiar os dois helpers do Post sem alteração.
- [ ] **Step 4:** Rodar `node --test` na raiz. Esperado: termina sem erro (0 testes).
- [ ] **Step 5:** Perguntar ao dono se pode fazer o primeiro commit com o estado atual inteiro (histórico do gerador local) — mensagem `chore: gerador local antes da versão online`.

### Task 2: `src/parse.gs` — leitura do link do Mercado Livre

**Files:**
- Create: `src/parse.gs`
- Create: `test/fixtures/social-com-desconto.html`, `test/fixtures/social-sem-desconto.html`, `test/fixtures/produto-og.html`
- Test: `test/parse.test.js`

**Interfaces:**
- Produces (funções puras, sem serviços do Apps Script):
  - `hostDe_(url) -> string|null`, `hostProdutoPermitido(url) -> boolean`, `hostImagemPermitido(url) -> boolean` (copiadas do Post, listas da seção Global Constraints, sem Shopee).
  - `destinoGo(url) -> string|null`: valor decodificado do parâmetro `go` quando ele é uma URL `https://`; senão `null`.
  - `parseSocial(html) -> {titulo, preco, precoAntigo, imagem, categoria, itemId} | null` — porta de `parseSocialPage` do `server.js` (linhas 319–349): polycard do `shared_item` (ou o primeiro `"polycards":[{`), componentes `title` e `price`, foto `https://http2.mlstatic.com/D_NQ_NP_2X_<id>-F.webp`, `domain_id` sem o prefixo `MLB-` e com `_` → espaço; plano B pelas tags `og:title`/`og:image`. `precoAntigo` é `null` quando não é maior que `preco`. Devolve `null` sem título e sem preço. Precisa de um leitor de objeto JSON a partir de `{` (porta de `jsonObjectAt`).
  - `parseProduto(html) -> {titulo, preco, precoAntigo, imagem}`: copiada do Post (página normal de produto).

Fixtures: HTML mínimo escrito à mão (não salvar página real aqui: o repositório é público e a página traz o nome do afiliado). `social-com-desconto.html` tem `og:title` "Boné Ogochi Básico - R$ 39,90", `"shared_item":{"id":"MLB6645312468"}`, um polycard com `metadata.id` = esse id, `title.text` "Boné Ogochi Básico Algodão", `price.current_price.value` 39.9, `price.previous_price.value` 67, `pictures.pictures[0].id` "123456-MLA0000000000_012025", e `"id":"MLB6645312468","category_id":"MLB1","domain_id":"MLB-HATS_AND_CAPS"`. `social-sem-desconto.html`: igual sem `previous_price`. `produto-og.html`: só `og:title`/`og:image`/`itemprop=price`.

- [ ] **Step 1: Testes que falham** em `test/parse.test.js` (carregar com `loadGs(['src/parse.gs'])`):
  - `parseSocial lê polycard com desconto` → `{titulo:'Boné Ogochi Básico Algodão', preco:39.9, precoAntigo:67, imagem:'https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA0000000000_012025-F.webp', categoria:'HATS AND CAPS', itemId:'MLB6645312468'}`.
  - `parseSocial sem previous_price dá precoAntigo null`.
  - `parseSocial com previous_price menor ou igual ao preço dá precoAntigo null`.
  - `parseSocial sem polycard usa og:title e og:image` (preço 39.9 tirado do fim do `og:title`, título sem o " - R$ …", imagem com o sufixo trocado para `-F.`).
  - `parseSocial em página sem título nem preço devolve null`.
  - `destinoGo devolve o destino decodificado` para `https://www.mercadolivre.com.br/gz/account-verification?go=https%3A%2F%2Fwww.mercadolivre.com.br%2Fsocial%2Fx` → `'https://www.mercadolivre.com.br/social/x'`; `null` sem `go` e para `go=javascript:...`.
  - `hostProdutoPermitido recusa shopee e aceita meli.la`; `hostImagemPermitido aceita http2.mlstatic.com`.
  - `parseProduto lê página normal` com `produto-og.html`.
- [ ] **Step 2:** `node --test test/parse.test.js` — esperado FAIL (arquivo `src/parse.gs` não existe).
- [ ] **Step 3:** Implementar `src/parse.gs` com as funções acima (código em ES5 compatível com Apps Script, como o Post: `var`, `function`).
- [ ] **Step 4:** `node --test test/parse.test.js` — esperado PASS.
- [ ] **Step 5:** Listar arquivos e perguntar sobre commit (`feat: leitura do link de afiliado no Apps Script`).

### Task 3: `src/acesso.gs` — login Google e sessões

**Files:**
- Create: `src/acesso.gs` (cópia do Post com `MAX_SESSOES_POR_CLIENTE_ = 3`)
- Test: `test/acesso.test.js` (cópia do Post, ajustada)

**Interfaces:**
- Produces (iguais ao Post): `verificarIdToken_(idToken) -> {ok, email}`, `buscarCliente_(email) -> {nome, ativo}|null`, `criarSessao_(email) -> string`, `emailDaSessao_(id) -> string|null`, `encerrarSessao_(id)`, `encerrarSessoesDoEmail_(email)`, `testarAcesso()`.

- [ ] **Step 1:** Copiar `test/acesso.test.js` do Post e trocar o teste `terceira sessão derruba a mais antiga` por `quarta sessão derruba a mais antiga` (cria 4 sessões; a 1ª deixa de valer, as 2ª–4ª continuam). Acrescentar `terceira sessão não derruba ninguém` (3 sessões, todas valem).
- [ ] **Step 2:** `node --test test/acesso.test.js` — esperado FAIL (sem `src/acesso.gs`).
- [ ] **Step 3:** Copiar `src/acesso.gs` do Post e mudar só a constante para `3`.
- [ ] **Step 4:** `node --test test/acesso.test.js` — esperado PASS.
- [ ] **Step 5:** Perguntar sobre commit (`feat: login Google com até 3 aparelhos`).

### Task 4: `src/Code.gs` — API `login`, `sair`, `info`, `img`

**Files:**
- Create: `src/Code.gs`
- Test: `test/code.test.js`

**Interfaces:**
- Consumes: Task 2 (`hostProdutoPermitido`, `hostImagemPermitido`, `destinoGo`, `parseSocial`, `parseProduto`), Task 3 (todas).
- Produces (contrato com a página, Task 7):
  - `{action:'login', idToken}` → `{ok:true, sessao, nome, email}` | `{ok:false, erro:'login'|'sem_acesso'}`
  - `{action:'sair', sessao}` → `{ok:true}`
  - `{action:'info', sessao, url}` → `{ok:true, titulo, preco, precoAntigo, imagem, categoria, urlFinal}` | `{ok:false, erro:'sessao'|'sem_acesso'|'host'|'link_curto'|'rede'}`
  - `{action:'img', sessao, url}` → `{ok:true, base64, mime}` | `{ok:false, erro:…}`
  - qualquer outra coisa → `{ok:false, erro:'acao'}`
  - `testarLink(url)` (para rodar no editor): registra com `console.log` o JSON de `buscarInfo_` para o link dado; com o argumento vazio usa `'https://meli.la/322az5s'`.

Partir do `src/Code.gs` do Post e tirar Kiwify, código por e-mail, Shopee e frase. `baixarPagina_(url)`: como no Post (redirecionamentos à mão, até 5, cada salto conferido na lista de hosts), mais: antes de buscar cada URL, se `destinoGo(url)` existir, troca por ele sem gastar um salto de rede. `buscarInfo_(url)`: cache de 1 hora por link (`i:` + md5); lê com `parseSocial` quando o caminho final começa com `/social/`, senão `parseProduto` (categoria `''`); sem título e sem preço → `link_curto`.

- [ ] **Step 1: Testes que falham** em `test/code.test.js` (carregar `src/parse.gs`, `src/acesso.gs`, `src/Code.gs`; helpers `ambiente`/`logado` como no Post):
  - `info sem sessão devolve sessao`; `info de cliente desativado devolve sem_acesso e apaga a sessão`.
  - `info com link da Shopee devolve host sem buscar nada` (`chamadas.fetch === 0`).
  - `info segue 301 até /social/ e lê o polycard`: fila `[{code:301, headers:{Location:'https://www.mercadolivre.com.br/social/loja?ref=x'}}, {code:200, body: social-com-desconto.html}]` → `{ok:true, titulo:'Boné Ogochi Básico Algodão', preco:39.9, precoAntigo:67, categoria:'HATS AND CAPS', urlFinal:'https://www.mercadolivre.com.br/social/loja?ref=x', …}`.
  - `info segue o go= da tela de login`: 302 para `…/gz/account-verification?go=<social codificado>` → a próxima URL buscada é o destino do `go`.
  - `info guarda no cache por 3600 s` e `segunda chamada não busca de novo`.
  - `info de página sem dados devolve link_curto`; `info com HTTP 500 devolve rede`.
  - `img devolve base64 e mime`; `img de host fora da lista devolve host`.
  - `login com token válido de cliente ativo cria sessão`; `ação desconhecida devolve acao`.
- [ ] **Step 2:** `node --test test/code.test.js` — esperado FAIL.
- [ ] **Step 3:** Implementar `src/Code.gs`.
- [ ] **Step 4:** `node --test` (todos) — esperado PASS.
- [ ] **Step 5:** Perguntar sobre commit (`feat: API do Apps Script para o Story`).

### Task 5: Servidor no ar e conferência do Mercado Livre (com o dono)

**Files:**
- Create: `README.md` (seções "Testes", "Implantação: 1. Cliente OAuth, 2. Backend (Apps Script)", "Clientes"), adaptando o README do Post: projeto Google Cloud "Gerador de Story", três arquivos `.gs`, planilha `Clientes`, propriedades `GOOGLE_CLIENT_ID` e `PLANILHA_ID`, `testarAcesso`, `testarLink`, implantação "Executar como: Eu / Qualquer pessoa".

Este é um ponto de parada: depende do dono.

- [ ] **Step 1:** Escrever as seções do README acima.
- [ ] **Step 2:** Guiar o dono, passo a passo: criar o projeto no Google Cloud e o cliente OAuth com as duas origens; criar a planilha com o e-mail dele; criar o Apps Script, colar `src/parse.gs`, `src/acesso.gs`, `src/Code.gs`; preencher as propriedades; rodar `testarAcesso`.
- [ ] **Step 3:** Pedir que ele rode `testarLink` e mande o print de Execuções. **Esperado:** título, preço 39,9, preço antigo 67 (ou os valores atuais do produto), foto `D_NQ_NP_2X_…-F.webp` e categoria preenchidos.
- [ ] **Step 4:** Se o preço antigo ou a foto do polycard não vierem: **parar o plano** e levar o resultado ao dono antes de qualquer trabalho na página.
- [ ] **Step 5:** Pedir a implantação como App da Web e anotar a URL `/exec` e o Client ID (os dois são públicos) para a Task 7.

### Task 6: `web/ia.js` — cenário com IA pelo navegador

**Files:**
- Create: `web/ia.js`
- Test: `test/ia.test.js`

**Interfaces:**
- Produces (funções globais de script comum, carregáveis no navegador e em `loadGs` para teste, como o `web/frase.js` do Post):
  - `pedidoCena(cfg, prompt) -> {url, init}` — cena sem produto. `cfg = {provider:'pollinations'|'gemini'|'openai', key, model}`. Pollinations sem chave: `GET https://image.pollinations.ai/prompt/<prompt>?width=1080&height=1920&nologo=true&seed=<n>&model=flux`; com chave: `https://gen.pollinations.ai/image/<prompt>?…&model=<model||'zimage'>` com `Authorization: Bearer`. OpenAI: `POST https://api.openai.com/v1/images/generations` JSON `{model: model||'gpt-image-1', prompt, size:'1024x1536', n:1}`. Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/<model||'gemini-2.5-flash-image'>:generateContent` com `x-goog-api-key`, `generationConfig:{responseModalities:['IMAGE'], imageConfig:{aspectRatio:'9:16'}}`.
  - `pedidoProduto(cfg, prompt, fotoDataUrl) -> {url, init}` — cena com o produto. Pollinations: `https://gen.pollinations.ai/v1/images/edits`, modelo `model||'kontext'`; OpenAI: `https://api.openai.com/v1/images/edits`, `model||'gpt-image-1'`; ambos `FormData` com `model`, `prompt`, `image` (Blob da foto), `size:'1024x1536'`, `n:'1'`. Gemini: mesmo endpoint da cena com `parts:[{inlineData:{mimeType, data}}, {text: prompt}]`. Sem chave: lança `Error` com as mesmas mensagens de `PRODUCT_SCENE` no `server.js` (linhas 192–209).
  - `segundosRetry(texto) -> number|null` — lê "retry after 31s" (sem diferenciar maiúsculas).
  - `lerImagem(resp) -> Promise<Blob>` — resposta `image/*` direto; JSON com `data[0].b64_json` ou `data[0].url` (busca a URL); JSON do Gemini com `inlineData`/`inline_data`. Sem imagem: `Error` com as mensagens do `server.js` ("Gemini não retornou imagem (o pedido pode ter sido bloqueado pelo filtro de conteúdo).", "OpenAI não retornou imagem.").
  - `gerarImagem(pedido, quem) -> Promise<Blob>` — `fetch` com `AbortController` de 240 s; até 4 tentativas; em 402/429/≥500 espera `segundosRetry(texto)` (padrão 10, desiste se > 60) + 2 s; 401/403 lança na hora "<quem> recusou a chave (confira a chave nas Configurações da IA)."; demora → "A IA demorou demais para responder. Tente de novo.".
  - A espera usa uma função `esperar_(ms)` que os testes trocam por uma que resolve na hora.

- [ ] **Step 1: Testes que falham** em `test/ia.test.js`, com `fetch`, `FormData`, `Blob`, `AbortController` do Node passados em `loadGs(['web/ia.js'], {...})`:
  - `pollinations sem chave usa image.pollinations.ai com GET e model flux`; `com chave usa gen.pollinations.ai e Bearer`.
  - `chave nunca aparece na URL` (para os 3 provedores, nas duas funções).
  - `gemini manda aspectRatio 9:16 e a chave no x-goog-api-key`.
  - `pedidoProduto sem chave do pollinations lança a mensagem de criar chave grátis`.
  - `segundosRetry lê "Retry after 31s"` → 31; texto sem número → `null`.
  - `gerarImagem tenta de novo em 402 e devolve a imagem na segunda`.
  - `gerarImagem em 401 lança na hora sem tentar de novo` (1 chamada).
  - `gerarImagem desiste quando o retry pedido passa de 60 s`.
  - `lerImagem lê b64_json do formato OpenAI` e `lê inlineData do Gemini`.
- [ ] **Step 2:** `node --test test/ia.test.js` — esperado FAIL.
- [ ] **Step 3:** Implementar `web/ia.js` (portar a lógica de `server.js` linhas 105–216; `Buffer` vira `Blob`/`atob`).
- [ ] **Step 4:** `node --test` — esperado PASS.
- [ ] **Step 5:** Perguntar sobre commit (`feat: cenário com IA direto do navegador`).

### Task 7: `web/index.html` — página online com login

**Files:**
- Create: `web/index.html` (a partir de `public/index.html`), `web/manifest.json`, `web/sw.js`, `web/icon-192.png`, `web/icon-512.png`
- Test: `test/web.test.js`

**Interfaces:**
- Consumes: contrato da API (Task 4), `web/ia.js` (Task 6), `API_URL` e `GOOGLE_CLIENT_ID` (Task 5, Step 5).
- Produces: `api(params) -> Promise<{ok, …}>` na página (mesma lógica do `api` do Post: POST sem `Content-Type`, sessão `gs_sessao` no corpo; em `sessao` → volta ao login com "Sua sessão terminou (sua conta entrou em outro aparelho). Entre de novo."; em `sem_acesso` → "Seu acesso foi desativado."; só derruba se a sessão ainda for a enviada).

Mudanças em relação ao `public/index.html`:
- **Sai:** `_fetch`/wrapper de 401, `/api/me`, `/api/logout`, painel `#mlcfg` e `refreshMl`/`mlSave`, bookmarklet `#bm`/`bookmarklet()`/`#openLink`/`readHash()`, `fetch('/api/ping')`, `window.name`.
- **Entra:** tela `#telaLogin` antes do app, com o botão do Google (lógica de `iniciarGoogle`/`renderizarBotaoGoogle`/`aoLogar`/`voltarLogin` do Post, `gs_sessao`/`gs_nome`); nome da conta e botão Sair (`#logout` atual passa a chamar `api({action:'sair'})`); `<script src="ia.js">`; `manifest.json` + registro do `sw.js` (iguais aos do Post, nome "Gerador de Story", `short_name` "Gerador Story", `theme_color` `#ffc61a`).
- **`pullFromLink`:** `api({action:'info', url})`; mapeia `{titulo, preco, precoAntigo, imagem, categoria, urlFinal}` para o `applyOffer` atual (`title`, `price`, `old`, `image`, `category`). Erros: `host` → "Esse link não é do Mercado Livre."; `link_curto` → "Não achei os dados nesse link. Confira se é o link de afiliado ou envie a foto e digite o preço."; `rede` → "Não consegui falar com o Mercado Livre agora. Tente de novo.".
- **Foto:** `applyOffer` troca `/api/img?url=` por `api({action:'img', url})` → `data:<mime>;base64,<base64>` → `loadImgUrl`.
- **`generateBackground`:** troca os dois `fetch('/api/…')` por `gerarImagem(integrate ? pedidoProduto(cfg, productScenePrompt(), productDataUrl()) : pedidoCena(cfg, scenePrompt()), nome do provedor)`; o Blob vira `URL.createObjectURL` como hoje. O resto da função não muda.
- **Download no celular:** se `navigator.canShare?.({files:[arquivo]})`, abre o compartilhamento com o PNG; senão o `<a download>` atual.
- **Não muda:** tudo de `draw()` para baixo, controles de marca/selo/logo/aviso/cor, `cutWhite`, `productDataUrl`, `fitWidth`, prompts.

- [ ] **Step 1: Testes que falham** em `test/web.test.js` (leitura estática do HTML, como `tela-entrada.test.js` do Post):
  - `página não chama mais rotas /api/` (nenhuma ocorrência de `'/api/`).
  - `página carrega ia.js e o script do Google`.
  - `API_URL termina em /exec e GOOGLE_CLIENT_ID termina em .apps.googleusercontent.com`.
  - `tela de login vem antes do app` (`#telaLogin` antes de `<main`).
  - `sem bookmarklet nem painel da API do ML` (sem `id="bm"`, sem `id="mlcfg"`).
  - `manifest tem nome Gerador de Story e ícones 192 e 512`.
  - `chaves de sessão são gs_sessao e gs_nome`.
- [ ] **Step 2:** `node --test test/web.test.js` — esperado FAIL.
- [ ] **Step 3:** Montar `web/index.html` e os arquivos do app. Ícones: PNG 192 e 512, fundo `#ffc61a`, letra "S" escura centralizada (qualquer método de geração).
- [ ] **Step 4:** `node --test` — esperado PASS.
- [ ] **Step 5: Mesma arte, pixel a pixel.** Subir o gerador antigo (`PORT=3345 NO_OPEN=1 node server.js`) e o novo (`localhost:8765`). Nos dois, no console: esconder o login se preciso, preencher título "Copo Térmico Gocase 880ml", preço "92,05", antigo "399,90", cupom "PARAVOCEDEZ", fonte da marca `400|Pacifico`, cor `#ff4fa3`; mesma foto local (`loadImgUrl` + `setProduct`); `shuffleWord` fixo em "IMPERDÍVEL"; `draw()`. Comparar `canvas.toDataURL()` dos dois. **Esperado:** iguais. Diferença → corrigir antes de seguir.
- [ ] **Step 6:** Mostrar ao dono uma prévia da tela de login e da tela do gerador (print do navegador em largura de celular, 375 px) antes do commit.
- [ ] **Step 7:** Perguntar sobre commit (`feat: página online do Gerador de Story com login Google`).

### Task 8: Aposentar o gerador local e documentar

**Files:**
- Delete: `server.js`, `public/`, `render.yaml`, `INICIAR.bat`, `COMO-PUBLICAR.md`, `package.json`
- Modify: `.claude/launch.json` (fica só a configuração `web`), `README.md` (seções "3. Tela" e "4. Celular", do Post adaptadas: Cloudflare Pages com build `node --test` e saída `web`, endereço `gerador-de-story.pages.dev`, instalar como app)
- Create: `PROXIMOS-PASSOS.md` (o que está no ar, onde paramos, o que falta: venda, domínio `.com.br`, configurações sincronizadas, voltar sessões para 2; e "Como o dono gosta de trabalhar", igual ao do Post)

- [ ] **Step 1:** Apagar os arquivos e ajustar o `launch.json`.
- [ ] **Step 2:** `node --test` — esperado PASS. `grep -rn "localhost:3333\|INICIAR.bat\|/api/" web/ src/ README.md` — esperado: nada.
- [ ] **Step 3:** Completar `README.md` e escrever `PROXIMOS-PASSOS.md` (sem nenhuma chave, ID de planilha ou e-mail).
- [ ] **Step 4:** Perguntar sobre commit (`chore: aposenta o gerador local; documentação da versão online`).

### Task 9: Publicação e teste real (com o dono)

Ponto de parada: tudo aqui é feito pelo dono, guiado.

- [ ] **Step 1:** Dono cria o repositório no GitHub (público) e autoriza o `git remote add` + `git push -u origin main`.
- [ ] **Step 2:** Dono cria o projeto no Cloudflare Pages: importar o repositório, branch `main`, preset `None`, build `node --test`, saída `web`, nome `gerador-de-story` (se ocupado, o mais próximo livre — e então atualizar a origem no cliente OAuth e o README).
- [ ] **Step 3:** No celular: abrir o endereço, entrar com Google, colar `https://meli.la/322az5s`. **Esperado:** título, preço, "de R$" e foto preenchidos.
- [ ] **Step 4:** Colar a chave da IA em ⚙️ e gerar um cenário integrado. **Esperado:** produto inteiro na cena; "Baixar arte PNG" abre o compartilhamento do celular.
- [ ] **Step 5:** Entrar no PC e num terceiro aparelho; num quarto, conferir que o mais antigo volta para o login com aviso.
- [ ] **Step 6:** Atualizar `PROXIMOS-PASSOS.md` com o resultado e perguntar sobre commit e push.
