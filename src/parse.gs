// Funções puras de extração e validação. Sem dependência de serviços do Apps Script.
// Base: src/parse.gs do Gerador de Post (só a parte do Mercado Livre) + leitura da página social do afiliado.

var HOSTS_PRODUTO_ = ['mercadolivre.com.br', 'produto.mercadolivre.com.br', 'mercadolivre.com', 'mercadolibre.com', 'meli.la'];
var HOSTS_IMAGEM_ = ['mlstatic.com', 'mercadolivre.com.br', 'mercadolibre.com'];

function hostDe_(url) {
  var m = /^https:\/\/([^\/:?#@]+)(?::\d+)?(?:[\/?#]|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

function hostNaLista_(url, lista) {
  var host = hostDe_(url);
  if (!host) return false;
  for (var i = 0; i < lista.length; i++) {
    if (host === lista[i] || host.slice(-(lista[i].length + 1)) === '.' + lista[i]) return true;
  }
  return false;
}

function hostProdutoPermitido(url) {
  return hostNaLista_(url, HOSTS_PRODUTO_);
}

function hostImagemPermitido(url) {
  return hostNaLista_(url, HOSTS_IMAGEM_);
}

function decodificarEntidades_(s) {
  var nomes = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
    if (e.charAt(0) === '#') {
      var cod = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(cod) ? m : String.fromCodePoint(cod);
    }
    var v = nomes[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function metaContent_(html, attr, valor) {
  var tags = html.match(/<meta\b[^>]*>/gi) || [];
  var chave = new RegExp('\\b' + attr + '\\s*=\\s*["\']' + valor + '["\']', 'i');
  for (var i = 0; i < tags.length; i++) {
    if (chave.test(tags[i])) {
      var c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tags[i]);
      if (c) return c[1] !== undefined ? c[1] : c[2];
    }
  }
  return null;
}

function paraNumero_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function ehProduct_(item) {
  var t = item && item['@type'];
  return t === 'Product' || (Array.isArray(t) && t.indexOf('Product') !== -1);
}

function precoJsonLd_(html) {
  var re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html))) {
    var dados;
    try { dados = JSON.parse(m[1]); } catch (e) { continue; }
    var itens = Array.isArray(dados) ? dados.slice() : [dados];
    for (var i = 0; i < itens.length; i++) {
      if (itens[i] && Array.isArray(itens[i]['@graph'])) itens = itens.concat(itens[i]['@graph']);
    }
    for (var j = 0; j < itens.length; j++) {
      if (!ehProduct_(itens[j])) continue;
      var ofertas = itens[j].offers;
      var oferta = Array.isArray(ofertas) ? ofertas[0] : ofertas;
      var preco = oferta ? paraNumero_(oferta.price) : null;
      if (preco !== null) return preco;
    }
  }
  return null;
}

// O preço antigo do produto fica no bloco principal de preço (classe ui-pdp-price*).
// Sem esse marcador na página, cai no primeiro preço antigo encontrado.
function precoAntigo_(html) {
  var escopo = html;
  var marca = /class\s*=\s*["'][^"']*ui-pdp-price/i.exec(html);
  if (marca) escopo = html.substr(marca.index, 3000);
  var tag = /<[^>]*andes-money-amount--previous[^>]*>/i.exec(escopo);
  if (!tag) return null;
  var rotulo = /aria-label\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  if (!rotulo) return null;
  var v = /(\d[\d.]*)\s+reais(?:\s+com\s+(\d+)\s+centavos?)?/i.exec(rotulo[1]);
  if (!v) return null;
  var reais = Number(v[1].replace(/\./g, ''));
  var centavos = v[2] ? Number(v[2]) : 0;
  return isFinite(reais) ? reais + centavos / 100 : null;
}

// '1.554,90' -> 1554.9; '64,99' -> 64.99; '359' -> 359
function valorBR_(s) {
  var n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}

function parseProduto(html) {
  html = String(html || '');
  var titulo = metaContent_(html, 'property', 'og:title');
  var precoTitulo = null;
  if (titulo !== null) {
    titulo = decodificarEntidades_(titulo).replace(/\s*\|\s*Mercado\s?Livre\s*$/i, '');
    // O ML põe o preço atual no fim do og:title. Na página "social" do afiliado é o único lugar com ele.
    var sufixo = /\s+-\s+R\$\s*(\d[\d.]*(?:,\d{1,2})?)\s*$/.exec(titulo);
    if (sufixo) {
      precoTitulo = valorBR_(sufixo[1]);
      titulo = titulo.slice(0, sufixo.index);
    }
    titulo = titulo.trim();
    if (titulo === '') titulo = null;
  }
  var imagem = metaContent_(html, 'property', 'og:image');
  var preco = precoJsonLd_(html);
  if (preco === null) preco = paraNumero_(metaContent_(html, 'itemprop', 'price'));
  if (preco === null) preco = precoTitulo;
  return { titulo: titulo, preco: preco, precoAntigo: precoAntigo_(html), imagem: imagem };
}

// A tela de login do ML guarda o destino em ?go=. Só aceita destino https.
function destinoGo(url) {
  var m = /[?&]go=([^&#]*)/.exec(String(url || ''));
  if (!m) return null;
  var destino;
  try { destino = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return null; }
  return /^https:\/\//i.test(destino) ? destino : null;
}

// Lê o objeto JSON que começa em s.charAt(i) === '{'.
function objetoJsonEm_(s, i) {
  var nivel = 0, emTexto = false, escape = false;
  for (var j = i; j < s.length; j++) {
    var c = s.charAt(j);
    if (emTexto) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === '{') nivel++;
    else if (c === '}' && --nivel === 0) {
      try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
    }
  }
  return null;
}

function componente_(card, tipo) {
  var lista = (card && card.components) || [];
  for (var i = 0; i < lista.length; i++) {
    if (lista[i] && lista[i].type === tipo) return lista[i][tipo] || null;
  }
  return null;
}

// "Antes: 2.499 reais com 90 centavos" -> 2499.9
function valorRotulo_(rotulo) {
  var v = /(\d[\d.]*)\s+reais(?:\s+com\s+(\d+)\s+centavos?)?/i.exec(String(rotulo || ''));
  if (!v) return null;
  var n = Number(v[1].replace(/\./g, '')) + (v[2] ? Number(v[2]) / 100 : 0);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function normalizarTitulo_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Cartão visível do produto compartilhado (classe poly-card, marcado como card-featured).
// É o que vem na versão "estática" da página social, sem os dados em JSON.
function cartaoSocial_(html) {
  var blocos = html.split(/class="poly-card[\s"]/).slice(1);
  if (!blocos.length) return null;
  var bloco = null;
  for (var i = 0; i < blocos.length; i++) {
    if (blocos[i].indexOf('/card-featured/') >= 0) { bloco = blocos[i]; break; }
  }
  // Sem a marca de destaque, só aceita o cartão com o mesmo título do og:title (o produto
  // compartilhado). Pegar o primeiro cartão poderia trazer outro produto da vitrine.
  if (!bloco) {
    var og = metaContent_(html, 'property', 'og:title');
    var alvo = normalizarTitulo_(og === null ? '' : decodificarEntidades_(og).replace(/\s+-\s+R\$\s*[\d.,]+\s*$/, ''));
    for (var j = 0; alvo && j < blocos.length; j++) {
      var t = normalizarTitulo_(decodificarEntidades_((/class="poly-component__title"[^>]*>([^<]+)</.exec(blocos[j]) || [])[1] || ''));
      if (t && (t === alvo || t.indexOf(alvo) === 0 || alvo.indexOf(t) === 0)) { bloco = blocos[j]; break; }
    }
  }
  if (!bloco) return null;
  var titulo = (/class="poly-component__title"[^>]*>([^<]+)</.exec(bloco) || [])[1];
  var antes = (/aria-label="Antes:\s*([^"]*)"/.exec(bloco) || [])[1];
  var agora = (/aria-label="Agora:\s*([^"]*)"/.exec(bloco) || [])[1];
  var foto = (/class="poly-component__picture"[^>]*?\s(?:data-src|src)="(https:\/\/[^"]*mlstatic\.com\/[^"]+)"/.exec(bloco) || [])[1];
  var id = (/[?&#;]wid=(ML[A-Z]\d+)/.exec(bloco) || /item_id%3A(ML[A-Z]\d+)/.exec(bloco) || [])[1];
  return {
    titulo: titulo ? decodificarEntidades_(titulo).trim() : null,
    preco: valorRotulo_(agora),
    precoAntigo: valorRotulo_(antes),
    imagem: foto ? foto.replace('/D_Q_NP_', '/D_NQ_NP_').replace(/-[A-Z]{1,2}\.(webp|jpg|png)$/i, '-F.$1') : null,
    itemId: id || null
  };
}

// Página "social" do afiliado (para onde o link meli.la leva): o produto compartilhado vem num
// "polycard" com título, preço atual, preço antigo e foto. Plano B: as tags og:title/og:image.
function parseSocial(html) {
  html = String(html || '');
  var compartilhado = (/"shared_item":\{"id":"(ML[A-Z]\d+)"/.exec(html) || [])[1];
  var card = null;
  if (compartilhado) {
    var em = html.indexOf('"metadata":{"id":"' + compartilhado + '"');
    var inicio = em > 0 ? html.lastIndexOf('{"unique_id"', em) : -1;
    if (inicio >= 0) card = objetoJsonEm_(html, inicio);
  }
  if (!card) {
    var k = html.indexOf('"polycards":[{');
    if (k >= 0) card = objetoJsonEm_(html, k + '"polycards":['.length);
  }

  // Sem os dados em JSON (versão que chega aos servidores do Google): lê o cartão visível.
  var cartao = card ? null : cartaoSocial_(html) || {};
  cartao = cartao || {};

  var tituloComp = componente_(card, 'title');
  var precoComp = componente_(card, 'price') || {};
  var titulo = (tituloComp && tituloComp.text) || cartao.titulo || '';
  var preco = Number(precoComp.current_price && precoComp.current_price.value) || cartao.preco || 0;
  var antigo = Number(precoComp.previous_price && precoComp.previous_price.value) || cartao.precoAntigo || 0;
  var fotoId = card && card.pictures && card.pictures.pictures && card.pictures.pictures[0] && card.pictures.pictures[0].id;
  var imagem = fotoId ? 'https://http2.mlstatic.com/D_NQ_NP_2X_' + fotoId + '-F.webp' : cartao.imagem || '';

  var ogTitulo = metaContent_(html, 'property', 'og:title');
  ogTitulo = ogTitulo === null ? '' : decodificarEntidades_(ogTitulo);
  if (!titulo && ogTitulo) titulo = ogTitulo.replace(/\s+-\s+R\$\s*[\d.,]+\s*$/, '').trim();
  if (!preco && ogTitulo) {
    var m = /R\$\s*([\d.]+(?:,\d{1,2})?)\s*$/.exec(ogTitulo);
    if (m) preco = valorBR_(m[1]) || 0;
  }
  var ogImagem = metaContent_(html, 'property', 'og:image');
  if (!imagem && ogImagem) imagem = decodificarEntidades_(ogImagem).replace(/-[A-Z]\.(webp|jpg|png)$/i, '-F.$1');

  var itemId = (card && card.metadata && card.metadata.id) || compartilhado || cartao.itemId || null;
  var dominio = itemId ? (new RegExp('"id":"' + itemId + '","category_id":"[^"]*","domain_id":"ML[A-Z]-([A-Z_]+)"').exec(html) || [])[1] : '';
  if (!titulo && !preco) return null;
  return {
    titulo: titulo || null,
    preco: preco || null,
    precoAntigo: antigo > preco ? antigo : null,
    imagem: imagem || null,
    categoria: (dominio || '').replace(/_/g, ' '),
    itemId: itemId
  };
}
