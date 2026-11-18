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
- **Login do Google:** projeto "Gerador de Story" no Google Cloud, cliente OAuth com as origens `https://gerador-de-story.pages.dev` e `http://localhost:8765`. Branding preenchido (página inicial, `/privacidade`, domínio `gerador-de-story.pages.dev`) e tela de consentimento **Em produção** desde 2026-11-18. Só usa nome e e-mail, então o limite de 100 usuários do OAuth não se aplica.
- **Site no ar:** https://gerador-de-story.pages.dev, pelo Cloudflare Pages ligado ao repositório público `Hydrosistem/gerador-de-story` (build `node --test`, saída `web`). **Push na main = produção.**
- **Página (`web/`):** a mesma arte do gerador antigo, idêntica pixel a pixel; puxar dados pelo Apps Script; cenário com IA direto do navegador; baixar abre o compartilhar no celular; instalável como app.
- **Teste real (2026-11-18, em localhost:8765):** login Google, link `meli.la` → 39,90 / de 67,00 / foto, e cenário com o produto dentro (Pollinations com chave), tudo funcionando.
- **Testes:** `node --test`, 87 passando.
- O gerador antigo (`INICIAR.bat`, `server.js`, `public/`) foi aposentado; está no primeiro commit do histórico.

## O que falta, em ordem

1. ~~**Publicar**~~: feito em 2026-11-18 (repositório, Cloudflare Pages).
2. ~~**Publicar o login do Google**~~: feito em 2026-11-18.
3. ~~**Teste no celular**~~: feito e aprovado pelo dono em 2026-11-18 (login, link, cenário com IA, baixar e instalar como app).
   Roteiro usado: entrar, colar um link, colar a chave do Pollinations em ⚙️, gerar o cenário e baixar a arte (deve abrir o compartilhar). Conferir que o 4º aparelho derruba o mais antigo.

## Para depois

**Ajustes pequenos apontados na revisão final (2026-11-18):**
- Link que começa com `http://` recebe "Esse link não é do Mercado Livre" (`hostDe_` só aceita https). Trocar para https antes de enviar.
- `hostDe_` aceita caracteres estranhos no host; restringir a `[a-z0-9.-]`.
- Mensagem "cenário gerado com o produto recortado por cima" em `generateBackground` não aparece mais (sem chave o Pollinations já pede a chave); remover.
- A geração com IA continua rodando depois de Sair ou Limpar; cancelar o pedido quando o trabalho mudar.
- Falta de crédito na OpenAI/Gemini (quota) é tentada de novo e aparece como "ocupado"; mostrar "sem crédito".
- Colar dois links muito rápido pode pôr a foto do primeiro na oferta do segundo; conferir o pedido antes de trocar a foto.
- A lógica da página (`api()`, mensagens de erro) só tem testes por leitura do HTML; separar em arquivo testável.
- Botão de olhinho no campo "Chave da API" para ver a chave salva no aparelho.

**Maiores:**

- **Venda:** Kiwify, entrada por código no e-mail (Brevo), página de vendas e termos, como no Post. Ao vender, voltar o limite de aparelhos para 2 (`MAX_SESSOES_POR_CLIENTE_` em `src/acesso.gs`).
- **Domínio próprio `.com.br`:** registrar e ligar no Cloudflare Pages; adicionar a origem no cliente OAuth e atualizar o Branding.
- **Configurações iguais em todos os aparelhos:** hoje marca, fonte, cores, logo e chave da IA ficam em cada aparelho.
- **Postagem automática** no WhatsApp/Telegram.

## Como o dono gosta de trabalhar

- Ele pede **commit e push** de forma explícita. Antes de mudanças visuais, quer ver uma **prévia**.
- Mudanças em `src/*.gs` só valem depois de `clasp push --force` e `clasp update-deployment <id>` (README, seção 2). Servidor e site incompatíveis precisam ir ao ar juntos.
- Para diagnosticar o servidor, peça para ele rodar no editor `testarAcesso`, `testarLink` ou `diagnosticarLink` e mandar o print de Execuções.
- Nunca colocar chaves em arquivos, nem repetir no chat segredos que ele colar.
