# Gerador de Story (Mercado Livre)

Cola o link de afiliado do Mercado Livre e monta a arte do Status do WhatsApp (1080 × 1920), com cenário de IA. Funciona no celular e no computador, entrando com a conta Google.

- **Site:** pasta `web/`, publicada no Cloudflare Pages.
- **Servidor:** Google Apps Script (`src/`). Faz o login e lê o link do Mercado Livre.
- **IA do cenário:** chamada direto do navegador, com a chave guardada no próprio aparelho. A chave nunca passa pelo servidor.

## Testes

```
node --test
```

## Implantação

### 1. Login do Google (Google Cloud)
1. Acesse console.cloud.google.com e crie um projeto novo chamado **Gerador de Story**.
2. APIs e serviços → Tela de consentimento OAuth: tipo **Externo**, nome do app "Gerador de Story", e-mail de suporte o seu. Depois **publique a tela em produção** (em teste, o login expira em poucos dias).
3. APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth → tipo **Aplicativo da Web**. Em "Origens JavaScript autorizadas" adicione:
   - `https://gerador-de-story.pages.dev`
   - `http://localhost:8765`
4. Copie o Client ID (termina em `.apps.googleusercontent.com`). Ele é público e vai no código e no passo 2.

### 2. Servidor (Apps Script, enviado pelo clasp)
O código do servidor vai para o Apps Script pelo **clasp**, a ferramenta de linha de comando oficial do Google (`npm install -g @google/clasp`). O projeto já está ligado em `.clasp.json` (pasta `src/`; a configuração do app da web fica em `src/appsscript.json`).

1. Uma vez por computador: ligue a **API Google Apps Script** em script.google.com/home/usersettings e rode `clasp login`.
2. Crie uma Planilha Google com uma aba (ou tabela) chamada `Clientes`. Linha 1: `email | nome | ativo` (pode ter também `pedido | data | origem`). Linha 2: o seu e-mail (em minúsculas), o seu nome e `sim`.
3. Envie o código: `clasp push --force`.
4. No editor do Apps Script (`clasp open-script` ou script.google.com): Configurações do projeto (⚙️) → Propriedades do script → adicione:
   - `PLANILHA_ID`: o ID da planilha (na URL, entre `/d/` e `/edit`);
   - `GOOGLE_CLIENT_ID`: o Client ID do passo 1.
5. No editor, rode `testarAcesso` (▶ Executar) e autorize quando pedir. Em Execuções deve aparecer o seu nome e `ativo: true`.
6. Rode `testarLink`. Deve aparecer o produto do link de teste com `titulo`, `preco`, `precoAntigo` e `imagem`. Se vier algo faltando, rode `diagnosticarLink` para ver o que a página trouxe.
7. Primeira implantação: `clasp create-deployment --description "Gerador de Story v1"`. A URL do app é `https://script.google.com/macros/s/<id da implantação>/exec` e vai em `API_URL`, no `web/index.html`.

Para atualizar depois (a URL `/exec` continua a mesma):

```
clasp push --force
clasp update-deployment <id da implantação> --description "o que mudou"
```

O id da implantação aparece em `clasp list-deployments` (a linha com "Gerador de Story", não a `@HEAD`).

### 3. Site (Cloudflare Pages)
1. Em `web/index.html`, confira `API_URL` (a URL `/exec` do passo 2) e `GOOGLE_CLIENT_ID` (o Client ID do passo 1). Os dois são públicos.
2. Envie o repositório ao GitHub.
3. No Cloudflare: Workers & Pages → Create → "Continue to Pages" → Import an existing Git repository. Branch `main`, preset `None`, build command `node --test`, output directory `web`, nome do projeto `gerador-de-story`.
4. Cada push na `main` roda os testes e publica a pasta `web/` em https://gerador-de-story.pages.dev. **Push na main = produção.**
5. Se o nome `gerador-de-story` estiver ocupado e o endereço sair diferente, adicione o endereço novo em "Origens JavaScript autorizadas" do cliente OAuth (passo 1).

### 4. Publicar o login do Google
Enquanto a tela de login estiver "Em teste", só entra quem está em **Usuários de teste** (Google Auth Platform → Público). Para liberar de vez:
1. Google Auth Platform → **Branding**: página inicial `https://gerador-de-story.pages.dev`, política de privacidade `https://gerador-de-story.pages.dev/privacidade`, domínio autorizado `gerador-de-story.pages.dev`.
2. Google Auth Platform → **Público** → **Publicar app** → Confirmar.

### 5. Celular
Abra https://gerador-de-story.pages.dev no Chrome, toque em "Entrar com Google" e depois em "Instalar app" (menu ⋮ → Instalar app / Adicionar à tela inicial).

### Chave da IA do cenário
Cada aparelho precisa da chave colada uma vez em ⚙️ "Configurações da IA de cenário". Ela fica só naquele aparelho e vai direto do navegador para a IA.
- **Pollinations:** chave grátis em enter.pollinations.ai (Keys → Secret key). Sem chave ele não funciona pelo navegador (pede uma verificação anti-robô).
- **Gemini:** chave em aistudio.google.com/apikey.
- **OpenAI:** chave em platform.openai.com.

## Testar no computador
Rode `python -m http.server 8765 --directory web` e abra http://localhost:8765 (essa origem está autorizada no login do Google).

## Clientes
- **Liberar alguém:** nova linha na aba `Clientes` com o e-mail (minúsculas), o nome e `sim` em `ativo`.
- **Bloquear:** troque `ativo` para `não`. O acesso cai no próximo pedido.
- Cada conta pode ficar logada em até **3 aparelhos** ao mesmo tempo; o quarto login derruba o mais antigo.

## Quando o Mercado Livre mudar a página
Se título ou preço vierem vazios, rode `testarLink` e `diagnosticarLink` no editor e confira o resultado. A leitura fica em `src/parse.gs`:
- `parseSocial`: página do afiliado (para onde o link `meli.la` leva). Os servidores do Google recebem a versão "estática" dessa página, sem os dados em JSON; por isso a leitura principal lá é o cartão visível do produto em destaque (`cartaoSocial_`: título, "Antes: … reais", "Agora: … reais", foto). Nessa versão a categoria vem vazia, e o gerador escolhe o cenário pelo título.
- `parseProduto`: página normal do produto.
