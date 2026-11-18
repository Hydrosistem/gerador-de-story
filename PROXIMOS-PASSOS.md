# Próximos passos: Gerador de Story

> Para retomar em outro computador ou numa conversa nova com o Claude:
> "Leia o PROXIMOS-PASSOS.md e o README.md e continue de onde paramos."
>
> Este arquivo não tem nenhuma senha, chave ou credencial. Os segredos ficam só nas
> Propriedades do script do Apps Script e no aparelho de cada pessoa, nunca no repositório.

Atualizado em 18 de novembro de 2026.

## O que já está pronto

- **Servidor (Apps Script "Gerador de Story"):** login Google, até 3 aparelhos por conta, leitura do link de afiliado e foto do produto. Enviado e implantado com o **clasp** (`.clasp.json`, pasta `src/`). Já está no ar e foi testado de verdade.
  - Os servidores do Google recebem a versão "estática" da página do afiliado (sem os dados em JSON). A leitura é feita pelo cartão visível do produto em destaque (`cartaoSocial_` em `src/parse.gs`). `testarLink` e `diagnosticarLink` ajudam quando o Mercado Livre mudar a página.
- **Planilha "Gerador de Story - Clientes":** tabela `Clientes` no mesmo formato da do Post (`email | nome | ativo | pedido | data | origem`).
- **Login do Google:** projeto "Gerador de Story" no Google Cloud, cliente OAuth com as origens `https://gerador-de-story.pages.dev` e `http://localhost:8765`. A tela de consentimento ainda está **Em teste** (só entram os usuários de teste).
- **Página (`web/`):** a mesma arte do gerador antigo, idêntica pixel a pixel; puxar dados pelo Apps Script; cenário com IA direto do navegador; baixar abre o compartilhar no celular; instalável como app.
- **Teste real (2026-11-18, em localhost:8765):** login Google, link `meli.la` → 39,90 / de 67,00 / foto, e cenário com o produto dentro (Pollinations com chave), tudo funcionando.
- **Testes:** `node --test`, 87 passando.
- O gerador antigo (`INICIAR.bat`, `server.js`, `public/`) foi aposentado; está no primeiro commit do histórico.

## O que falta, em ordem

1. **Publicar:** criar o repositório no GitHub (público, como o do Post), dar push e criar o projeto `gerador-de-story` no Cloudflare Pages (README, seção 3).
2. **Publicar o login do Google:** com o site no ar, preencher o Branding (página inicial, privacidade, domínio) e clicar em Publicar app (README, seção 4).
3. **Teste no celular:** entrar, colar um link, colar a chave do Pollinations em ⚙️, gerar o cenário e baixar a arte (deve abrir o compartilhar). Conferir que o 4º aparelho derruba o mais antigo.

## Para depois

- **Venda:** Kiwify, entrada por código no e-mail (Brevo), página de vendas e termos, como no Post. Ao vender, voltar o limite de aparelhos para 2 (`MAX_SESSOES_POR_CLIENTE_` em `src/acesso.gs`).
- **Domínio próprio `.com.br`:** registrar e ligar no Cloudflare Pages; adicionar a origem no cliente OAuth e atualizar o Branding.
- **Configurações iguais em todos os aparelhos:** hoje marca, fonte, cores, logo e chave da IA ficam em cada aparelho.
- **Postagem automática** no WhatsApp/Telegram.

## Como o dono gosta de trabalhar

- Ele pede **commit e push** de forma explícita. Antes de mudanças visuais, quer ver uma **prévia**.
- Mudanças em `src/*.gs` só valem depois de `clasp push --force` e `clasp update-deployment <id>` (README, seção 2). Servidor e site incompatíveis precisam ir ao ar juntos.
- Para diagnosticar o servidor, peça para ele rodar no editor `testarAcesso`, `testarLink` ou `diagnosticarLink` e mandar o print de Execuções.
- Nunca colocar chaves em arquivos, nem repetir no chat segredos que ele colar.
