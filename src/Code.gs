// Web app do Apps Script do Gerador de Story. Depende de src/parse.gs e src/acesso.gs (mesmo projeto).
// Base: src/Code.gs do Gerador de Post, só com login, sair, info e img.

var UA_ = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var MAX_REDIRECIONAMENTOS_ = 5;
var TTL_CACHE_ = 3600;
var LINK_TESTE_ = 'https://meli.la/322az5s';

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return resposta_({ ok: false, erro: 'acao' });
}

// Confere a sessão e, a cada chamada, se o cliente continua ativo na planilha
// (desativar na planilha encerra o acesso na próxima chamada).
function autenticar_(sessao) {
  var email = emailDaSessao_(sessao);
  if (!email) return { ok: false, erro: 'sessao' };
  var cliente = buscarCliente_(email);
  if (!cliente || !cliente.ativo) {
    encerrarSessao_(sessao);
    return { ok: false, erro: 'sem_acesso' };
  }
  return { ok: true, email: email, cliente: cliente };
}

function login_(idToken) {
  var verificado = verificarIdToken_(idToken);
  if (!verificado.ok) return { ok: false, erro: 'login' };
  var cliente = buscarCliente_(verificado.email);
  if (!cliente || !cliente.ativo) return { ok: false, erro: 'sem_acesso' };
  var sessao = criarSessao_(verificado.email);
  return { ok: true, sessao: sessao, nome: cliente.nome, email: verificado.email };
}

function doPost(e) {
  try {
    var p;
    try {
      p = JSON.parse(e && e.postData && e.postData.contents);
    } catch (err) {
      return resposta_({ ok: false, erro: 'acao' });
    }
    if (!p || typeof p !== 'object') return resposta_({ ok: false, erro: 'acao' });

    if (p.action === 'login') return resposta_(login_(p.idToken));

    if (p.action === 'sair') {
      encerrarSessao_(p.sessao);
      return resposta_({ ok: true });
    }

    if (p.action === 'info' || p.action === 'img') {
      var auth = autenticar_(p.sessao);
      if (!auth.ok) return resposta_(auth);
      return resposta_(p.action === 'info' ? buscarInfo_(p.url) : buscarImagem_(p.url));
    }

    return resposta_({ ok: false, erro: 'acao' });
  } catch (err) {
    console.error('doPost: ' + err);
    return resposta_({ ok: false, erro: 'rede' });
  }
}

function cabecalho_(resp, nome) {
  var h = resp.getHeaders();
  var alvo = nome.toLowerCase();
  for (var k in h) {
    if (k.toLowerCase() === alvo) return h[k];
  }
  return null;
}

function md5Hex_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texto);
  return bytes.map(function (b) {
    return ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0');
  }).join('');
}

// Segue redirecionamentos à mão: o UrlFetchApp não expõe a URL final e cada salto precisa passar pela
// lista de hosts. Quando o ML manda para a tela de login com ?go=<destino>, vai direto ao destino.
function baixarPagina_(url) {
  var atual = url;
  for (var salto = 0; salto <= MAX_REDIRECIONAMENTOS_; salto++) {
    var destino = destinoGo(atual);
    if (destino) atual = destino;
    if (!hostProdutoPermitido(atual)) return { erro: 'host' };
    var resp;
    try {
      resp = UrlFetchApp.fetch(atual, {
        followRedirects: false,
        muteHttpExceptions: true,
        headers: { 'User-Agent': UA_, 'Accept-Language': 'pt-BR,pt;q=0.9' }
      });
    } catch (err) {
      return { erro: 'rede' };
    }
    var code = resp.getResponseCode();
    if (code >= 300 && code < 400) {
      var proximo = cabecalho_(resp, 'Location');
      if (!proximo) return { erro: 'rede' };
      atual = proximo.charAt(0) === '/' ? 'https://' + hostDe_(atual) + proximo : proximo;
      continue;
    }
    if (code < 200 || code >= 300) return { erro: 'rede' };
    return { resp: resp, urlFinal: atual };
  }
  return { erro: 'rede' };
}

function paginaSocial_(url) {
  return /^https:\/\/[^\/?#]+\/social\//i.test(String(url || ''));
}

function buscarInfo_(url) {
  if (!hostProdutoPermitido(url)) return { ok: false, erro: 'host' };
  var cache = CacheService.getScriptCache();
  var chave = 'i:' + md5Hex_(url);
  var salvo = cache.get(chave);
  if (salvo) return JSON.parse(salvo);

  var pagina = baixarPagina_(url);
  if (pagina.erro) return { ok: false, erro: pagina.erro };
  var html = pagina.resp.getContentText();
  var d = paginaSocial_(pagina.urlFinal) ? parseSocial(html) : null;
  if (!d) {
    var p = parseProduto(html);
    d = { titulo: p.titulo, preco: p.preco, precoAntigo: p.precoAntigo, imagem: p.imagem, categoria: '' };
  }
  if (d.titulo === null && d.preco === null) return { ok: false, erro: 'link_curto' };

  var out = {
    ok: true,
    titulo: d.titulo,
    preco: d.preco,
    precoAntigo: d.precoAntigo,
    imagem: d.imagem,
    categoria: d.categoria || '',
    urlFinal: pagina.urlFinal
  };
  // Sem preço provavelmente é uma página incompleta: não guarda, para a próxima tentativa buscar de novo.
  if (out.preco !== null) cache.put(chave, JSON.stringify(out), TTL_CACHE_);
  return out;
}

function buscarImagem_(url) {
  if (!hostImagemPermitido(url)) return { ok: false, erro: 'host' };
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      followRedirects: false,
      muteHttpExceptions: true,
      headers: { 'User-Agent': UA_ }
    });
  } catch (err) {
    return { ok: false, erro: 'rede' };
  }
  if (resp.getResponseCode() !== 200) return { ok: false, erro: 'rede' };
  var mime = String(cabecalho_(resp, 'Content-Type') || 'image/jpeg').split(';')[0];
  return { ok: true, base64: Utilities.base64Encode(resp.getContent()), mime: mime };
}

// Para rodar no editor (▶): busca um link de afiliado e mostra em Execuções o que veio.
// Confere se a página do afiliado chega aos servidores do Google com preço antigo e foto.
function testarLink(url) {
  var link = typeof url === 'string' && url ? url : LINK_TESTE_;
  console.log(JSON.stringify(buscarInfo_(link)));
}

// Para rodar no editor (▶): mostra o que a página do link trouxe, sem cache e sem dados pessoais.
function diagnosticarLink(url) {
  var link = typeof url === 'string' && url ? url : LINK_TESTE_;
  var pagina = baixarPagina_(link);
  if (pagina.erro) {
    console.log(JSON.stringify({ erro: pagina.erro }));
    return;
  }
  var html = pagina.resp.getContentText();
  var marcadores = ['shared_item', 'polycards', 'previous_price', '__PRELOADED_STATE__', 'og:title', 'account-verification',
    'poly-card', 'andes-money-amount--previous', 'aria-label="Antes', 'og:url', 'canonical'];
  var achou = {};
  for (var i = 0; i < marcadores.length; i++) achou[marcadores[i]] = html.indexOf(marcadores[i]) >= 0;
  var ids = html.match(/ML[A-Z]-?\d{8,}/g) || [];
  console.log(JSON.stringify({ urlFinal: pagina.urlFinal, tamanho: html.length, marcadores: achou, idsProduto: ids.length, primeirosIds: ids.slice(0, 8) }));
  var antes = html.indexOf('aria-label="Antes');
  if (antes >= 0) console.log('ANTES: ' + html.slice(antes - 200, antes + 200));
  var titulo = html.indexOf('poly-component__title');
  if (titulo >= 0) console.log('CARTAO: ' + html.slice(titulo, titulo + 400));
  console.log('INICIO: ' + html.slice(0, 600));
}
