# Gerador de Story online — design

Data: 2026-11-18. Objetivo: usar o Gerador de Story de qualquer lugar (celular, outro computador) entrando com a conta Google, no mesmo modelo do Gerador de Post, mas como um sistema separado.

## Por quê

Hoje o gerador só roda no PC do dono (`INICIAR.bat` → `node server.js` em `localhost:3333`). Ele quer abrir no celular ou em outro computador, entrar com a própria conta e gerar a arte do Status como faz hoje. No começo é só para ele; mais tarde pode virar produto para clientes, como o Post. Também mais tarde ele compra um domínio próprio `.com.br`.

## Metas

1. Site em `https://gerador-de-story.pages.dev` (ou o nome livre mais próximo), servido pelo Cloudflare Pages a partir da pasta `web/`.
2. Login com Google. Só entra quem está ativo na aba `Clientes` de uma planilha nova (no começo, só o e-mail do dono).
3. Colar o link de afiliado do Mercado Livre puxa título, preço, preço antigo e foto, como hoje.
4. Cenário com IA (cena com o produto integrado e fundo sem produto) funcionando como hoje, com Pollinations, Gemini e OpenAI.
5. A arte final fica **igual** à do gerador local atual (layout do Status, marca com fonte/cor/tamanho, etiqueta, preço, selo de desconto, cupom, aviso lateral, logo).
6. Instalável no celular como app (manifest + service worker mínimo, igual ao Post).

## Fora do escopo (por enquanto)

- Venda: Kiwify, entrada por código no e-mail (Brevo), página de vendas, termos/privacidade. A estrutura de clientes já fica pronta para isso entrar depois.
- Domínio próprio (entra depois no Cloudflare, como no Post).
- Configurações sincronizadas entre aparelhos: marca, fonte, cores, logo e chaves da IA ficam no `localStorage` de cada aparelho, como hoje. (Ver "Decisões do builder" — candidato forte para a versão seguinte.)
- Shopee, postagem automática no WhatsApp/Telegram.
- API oficial do Mercado Livre (painel `ML_CLIENT_ID/SECRET`) e o "Plano B" do bookmarklet: saem. O link de afiliado já é lido pela página "social" do afiliado.

## Anti-metas (falharia mesmo funcionando)

- Arte diferente da atual, ou produto cortado/menor/maior do que hoje.
- Chave de IA do dono passando pelo servidor ou gravada em arquivo/repositório.
- Qualquer alteração no link de afiliado colado (a comissão é do dono).
- Mexer no Gerador de Post (outro repositório, outro Apps Script, outra planilha).

## Abordagens consideradas

- **A) Igual ao Post — escolhida.** Cloudflare Pages (site estático) + Apps Script novo como API JSON + login Google (GIS) + planilha de clientes; IA chamada direto do navegador. Mesmo caminho já em produção no Post, endereço `pages.dev`, instalável como app, domínio próprio fácil depois.
- **B) Tudo no Apps Script (HtmlService).** Sem Cloudflare e sem cliente OAuth, mas endereço longo, faixa de aviso do Google, não instala como app e falha com várias contas Google logadas. Descartada.
- Render / servidor no PC com túnel: descartadas por não seguirem o modelo do Post.

## Como funciona

### Repositório e pastas (espelha o Post)

```
Gerador de Story/
  web/            site publicado (index.html, manifest.json, sw.js, ícones)
  src/            arquivos do Apps Script (Code.gs, acesso.gs, parse.gs)
  test/           node --test (+ helpers de stub do Apps Script copiados do Post)
  docs/superpowers/specs|plans
  README.md, PROXIMOS-PASSOS.md
```

Novo repositório git, enviado ao GitHub (público, como o Post; nada secreto no código). O `server.js`, `public/`, `render.yaml`, `INICIAR.bat`, `COMO-PUBLICAR.md` e `package.json` antigos são aposentados (ficam no primeiro commit para histórico e saem no seguinte). Para testar no PC: servidor estático em `localhost:8765` servindo `web/` (igual ao `launch.json` do Post).

### Servidor (Apps Script novo)

Copiado do Post e reduzido:

- `acesso.gs`: igual ao Post (conferência do ID token do Google, planilha `Clientes` `email | nome | ativo`, sessões por e-mail nas Propriedades do script, `testarAcesso`), com o limite de sessões por e-mail em `MAX_SESSOES_POR_CLIENTE_ = 3` (decisão do dono: celular, PC e outro computador; quando virar produto, baixa para 2 como no Post).
- **Verificação primeiro:** antes de qualquer trabalho na página, um `testarLink` no editor do Apps Script busca um link `meli.la` real e mostra o que veio (título, preço, preço antigo, foto, categoria). Isso confirma que a página social chega aos servidores do Google com o bloco polycard (`shared_item`, `previous_price`, id da foto). `baixarPagina_` também passa a seguir o parâmetro `?go=` (como `resolveLink` no `server.js`). Se o polycard não vier, o plano para e volta ao dono antes de seguir.
- `Code.gs`: `doPost` com as ações `login`, `sair`, `info` e `img` (mesmo protocolo do Post: `POST` com corpo JSON em `text/plain`, sessão no corpo, respostas `{ok, erro}` com `sessao`/`sem_acesso`/`host`/`rede`/`link_curto`). Sem Kiwify, código por e-mail, Shopee nem IA no servidor.
- `parse.gs`: a parte Mercado Livre do Post **mais** a leitura da página social do afiliado que hoje está em `server.js` (`parseSocialPage`): `shared_item.id` → polycard com título, `current_price`, `previous_price`, primeira foto (`https://http2.mlstatic.com/D_NQ_NP_2X_<id>-F.webp`) e `domain_id`. Resposta de `info`: `{ok, titulo, preco, precoAntigo, imagem, categoria, urlFinal}`. Cache de 1 hora por link, como no Post.
- `img`: devolve a foto em base64 (`{ok, base64, mime}`); hosts permitidos `mlstatic.com` e `mercadolivre.com.br`/`mercadolibre.com`.
- Propriedades do script: `GOOGLE_CLIENT_ID`, `PLANILHA_ID`.

### Site (`web/index.html`)

O `public/index.html` atual vira a base, com estas trocas:

- **Login:** tela de entrada com o botão "Entrar com Google" (mesma lógica do Post: `gs_sessao`/`gs_nome` no `localStorage`, aviso quando a sessão cai ou o acesso é desativado, botão Sair). Substitui `login.html` e o cookie atual.
- **Puxar dados:** `/api/oferta` → `api({action:'info', url})`; `/api/img` → `api({action:'img', url})` e a foto entra no canvas como `data:` URL (não "suja" o canvas, o download continua funcionando).
- **IA no navegador:** a lógica de `server.js` (`genPollinations`, `genGemini`, `genOpenAI`, `editOpenAIStyle`, cena com produto, retentativas em 402/429/5xx respeitando "retry after") passa para JavaScript da página. CORS já conferido em 2026-11-18: Gemini, `gen.pollinations.ai`, `api.openai.com` e também `image.pollinations.ai` (Pollinations sem chave, `Access-Control-Allow-Origin: *`) aceitam chamadas do navegador. A imagem é baixada com `fetch` e vira `blob:`/`data:` URL antes de ir ao canvas, para não "sujar" o canvas e o download continuar funcionando.
- Somem: painel da API do ML, bookmarklet "Plano B", rota `/api/config`, `/api/ping`, `/api/me`.
- Fica tudo o resto: layout do Status, recorte do fundo branco, enquadramento 9:16 enviado à IA, preenchimento desfocado, controles de produto/marca/selo/logo/aviso/cor.
- `manifest.json` (nome "Gerador de Story", ícones próprios) e `sw.js` mínimo sem cache.

### Login do Google

Projeto novo no Google Cloud, "Gerador de Story", para a tela de login mostrar o nome certo. Cliente OAuth "Aplicativo da Web" com origens `https://gerador-de-story.pages.dev` e `http://localhost:8765`. Tela de consentimento publicada em produção (só escopos básicos de e-mail/perfil, sem verificação).

### Quem faz o quê

Como no Post: o código, o `git init` local, os testes e o README com o passo a passo ficam com o builder. As contas e painéis externos são configurados pelo dono, seguindo o README. Isso inclui o projeto no Google Cloud e o cliente OAuth, a planilha, o projeto do Apps Script e suas propriedades, o repositório no GitHub e o projeto no Cloudflare Pages. O builder guia cada passo e para quando depende do dono. Commit e push só quando o dono pedir.

### Publicação

1. Apps Script: colar `src/*.gs`, propriedades, rodar `testarAcesso`, Implantar → App da Web (Executar como: Eu; Acesso: Qualquer pessoa). A URL `/exec` vai em `API_URL` no `web/index.html`.
2. Cloudflare Pages: importar o repositório do GitHub, build `node --test`, saída `web`. Push na `main` = produção.
3. Primeiro teste real: colar um link de afiliado pelo celular e gerar um cenário com a chave do dono.

## Restrições

- Apps Script: 6 min por execução, Propriedades com 500 KB no total (sessões), cotas diárias de UrlFetch. A IA não passa por ele.
- Servidor e site incompatíveis precisam ir ao ar juntos (servidor primeiro).
- Jeito de trabalhar do dono: prévia antes de mudanças visuais; commit e push só quando ele pedir; nenhuma chave em arquivo, nem repetida no chat.

## Decisões do builder

- Estrutura interna do JavaScript da página (quanto separar em arquivos como `web/ia.js`), desde que a arte não mude.
- Testes: parse da página social com fixtures salvas, `doPost`/acesso com os stubs do Post, e funções puras da IA (montagem dos pedidos, leitura das respostas, retentativa). Conferência visual da arte comparando com o gerador local antes de aposentá-lo.
- Ícones do app.
- Configurações sincronizadas entre aparelhos ficam para a versão seguinte (decisão minha: mantém esta versão do tamanho do Post e não precisa de armazenamento extra; o logo em base64 não cabe nas Propriedades do script).
