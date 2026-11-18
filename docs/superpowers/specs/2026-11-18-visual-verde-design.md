# Visual verde WhatsApp — design curto

Data: 2026-11-18. Aprovado pelo dono na conversa (opção B, verde WhatsApp).

**Por quê:** o site do Story deve ter a cara de família do Gerador de Post (topo colorido arredondado, barra de vidro com ícones, tela de entrada com exemplo e passos), mas com cor própria.

**Abordagens consideradas:** A) roxo e rosa (recomendada: cor de "stories", combina com o botão de IA); B) verde WhatsApp (escolhida pelo dono: lembra o Status do WhatsApp; risco: compete com o verde do preço da arte); C) azul e violeta (sóbria, pouco ligada a stories).

**O que muda (só `web/`):**
- Topo: degradê verde `#25d366` → `#128c7e`, cantos de baixo arredondados, ícone do app + "Gerador de Story · Arte do Status em segundos", barra de vidro com ícones de categoria (mesmos símbolos do Post). "Lar de Achadinhos" sai do topo do site (continua na arte). Conta ("Olá, nome" + Sair) numa linha logo abaixo do topo, como no Post.
- Tela de entrada: título, texto de apoio, botão do Google, aviso da privacidade, exemplo de arte (miniatura) e 3 passos numerados: Cole o link → Gere o cenário → Baixe a arte.
- Dentro do gerador: mesmos campos e layout; botão principal e destaques em verde; botão de IA continua roxo/rosa.
- Ícone do app e `theme_color` em verde.

**Não muda:** a arte (`draw()` e tudo o que ele chama), os campos, o fluxo, o servidor.

**Anti-metas:** arte diferente; algo publicado sem o dono ver a prévia (push na main = produção).

**Decisões minhas:** cor principal dos botões `#128c7e` (o `#25d366` puro tem pouco contraste com texto branco); exemplo de arte gerado no próprio gerador, sem IA, para não gastar a chave do dono — pode ser trocado por um com cenário depois.
