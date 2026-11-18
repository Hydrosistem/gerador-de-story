# Como colocar o gerador online (com login)

Depois de publicado, você abre o gerador no celular ou em qualquer computador por um endereço como
`https://lar-de-achadinhos.onrender.com`, entra com usuário e senha, e o PC pode ficar desligado.

## Antes de tudo: o teste do Mercado Livre

No seu PC, puxar os dados pelo link de afiliado funciona. Em servidores de hospedagem o Mercado Livre
às vezes mostra a tela de login e bloqueia a leitura. **O primeiro teste depois de publicar é colar um
link de afiliado.** Se der erro, o resto (cenário com IA, foto, arte) continua funcionando, e você pode
enviar a foto e digitar o preço; me avise para buscarmos outra saída.

## Passo 1 — Colocar os arquivos no GitHub (grátis)

1. Crie uma conta em **github.com**.
2. Clique em **New repository**, dê um nome (ex.: `gerador-ofertas`), marque **Private** e crie.
3. Na página do repositório, clique em **uploading an existing file**.
4. Arraste estes itens da pasta `Gerar de Story`:
   - `server.js`, `package.json`, `render.yaml`
   - a pasta `public` inteira
5. **Não** envie o arquivo `config.json` (se existir): ele guarda chaves.
6. Clique em **Commit changes**.

## Passo 2 — Publicar no Render (grátis)

1. Crie uma conta em **render.com** (pode entrar com o GitHub).
2. Clique em **New → Blueprint** e escolha o repositório `gerador-ofertas`.
3. O Render vai pedir:
   - **APP_USER**: o usuário de login (ex.: `admin`)
   - **APP_PASSWORD**: uma senha forte, só sua
4. Clique em **Apply / Deploy** e espere ficar **Live** (alguns minutos).
5. Abra o endereço `https://….onrender.com` que aparece no topo e entre com o usuário e a senha.

## No plano grátis do Render

- Sem uso por 15 minutos, o servidor "dorme". O primeiro acesso depois disso demora **uns 50 segundos**.
- Para ficar sempre ligado, troque para o plano pago **Starter** no Render (cerca de US$ 7/mês).

## Depois de publicado

- **Chave da IA (Pollinations/Gemini/OpenAI):** cole de novo em "⚙️ Configurações da IA" em cada
  aparelho (fica salva no navegador de cada um).
- **API do Mercado Livre (opcional):** no Render, em **Environment**, adicione `ML_CLIENT_ID` e
  `ML_CLIENT_SECRET` (o servidor online apaga arquivos a cada reinício).
- **Trocar a senha:** Render → seu serviço → **Environment** → edite `APP_PASSWORD` → salve.
- **Atualizar o gerador:** envie os arquivos novos no GitHub (mesmo passo 1). O Render publica sozinho.

## No seu PC continua igual

O `INICIAR.bat` segue funcionando no seu computador, sem login.
