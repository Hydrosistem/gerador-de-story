const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadGs, plain } = require('./helpers/load-gs');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const ctx = loadGs(['src/parse.gs']);

const FOTO = 'https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA0000000000_012025-F.webp';

// ---- parseSocial (página "social" do afiliado) ----

test('parseSocial lê polycard com desconto', () => {
  assert.deepEqual(plain(ctx.parseSocial(fx('social-com-desconto.html'))), {
    titulo: 'Boné Ogochi Básico Algodão',
    preco: 39.9,
    precoAntigo: 67,
    precoCartao: null,
    imagem: FOTO,
    categoria: 'HATS AND CAPS',
    itemId: 'MLB6645312468',
  });
});

test('parseSocial sem previous_price dá precoAntigo null', () => {
  const r = plain(ctx.parseSocial(fx('social-sem-desconto.html')));
  assert.equal(r.preco, 39.9);
  assert.equal(r.precoAntigo, null);
  assert.equal(r.imagem, FOTO);
});

test('parseSocial com previous_price menor ou igual ao preço dá precoAntigo null', () => {
  const html = fx('social-com-desconto.html').replace('"previous_price":{"value":67}', '"previous_price":{"value":39.9}');
  assert.equal(ctx.parseSocial(html).precoAntigo, null);
});

test('parseSocial sem polycard usa og:title e og:image', () => {
  assert.deepEqual(plain(ctx.parseSocial(fx('social-og.html'))), {
    titulo: 'Boné Ogochi Básico',
    preco: 39.9,
    precoAntigo: null,
    precoCartao: null,
    imagem: 'https://http2.mlstatic.com/D_NQ_NP_123456-MLA0000000000_012025-F.webp',
    categoria: '',
    itemId: null,
  });
});

test('parseSocial em página sem título nem preço devolve null', () => {
  assert.equal(ctx.parseSocial('<html><head></head><body>login</body></html>'), null);
});

// ---- destinoGo (tela de login do ML guarda o destino em ?go=) ----

test('destinoGo devolve o destino decodificado', () => {
  const url =
    'https://www.mercadolivre.com.br/gz/account-verification?go=https%3A%2F%2Fwww.mercadolivre.com.br%2Fsocial%2Fx';
  assert.equal(ctx.destinoGo(url), 'https://www.mercadolivre.com.br/social/x');
});

test('destinoGo sem go devolve null', () => {
  assert.equal(ctx.destinoGo('https://www.mercadolivre.com.br/social/x'), null);
});

test('destinoGo recusa go que não é https', () => {
  assert.equal(ctx.destinoGo('https://www.mercadolivre.com.br/gz/x?go=javascript%3Aalert(1)'), null);
});

// ---- hosts ----

test('hostProdutoPermitido recusa shopee e aceita meli.la', () => {
  assert.equal(ctx.hostProdutoPermitido('https://shopee.com.br/produto-i.1.2'), false);
  assert.equal(ctx.hostProdutoPermitido('https://meli.la/322az5s'), true);
  assert.equal(ctx.hostProdutoPermitido('https://www.mercadolivre.com.br/social/x'), true);
  assert.equal(ctx.hostProdutoPermitido('http://meli.la/322az5s'), false);
});

test('hostImagemPermitido aceita http2.mlstatic.com e recusa outros', () => {
  assert.equal(ctx.hostImagemPermitido(FOTO), true);
  assert.equal(ctx.hostImagemPermitido('https://exemplo.com/foto.jpg'), false);
});

// ---- parseProduto (página normal de produto, copiada do Post) ----

test('parseProduto lê página normal', () => {
  assert.deepEqual(plain(ctx.parseProduto(fx('produto-og.html'))), {
    titulo: 'Fone Bluetooth X',
    preco: 149.9,
    precoAntigo: null,
    imagem: 'https://http2.mlstatic.com/D_NQ_NP_777-F.webp',
  });
});

// ---- parseSocial pelo cartão visível (versão da página que chega aos servidores do Google) ----

const FOTO_CARTAO = 'https://http2.mlstatic.com/D_NQ_NP_2X_709148-MLB119559890617_102026-F.webp';

test('parseSocial sem polycard lê o cartão em destaque', () => {
  assert.deepEqual(plain(ctx.parseSocial(fx('social-cartao.html'))), {
    titulo: 'Boné Ogochi Básico Algodão',
    preco: 39.9,
    precoAntigo: 67,
    precoCartao: null,
    imagem: FOTO_CARTAO,
    categoria: '',
    itemId: 'MLB6645312468',
  });
});

test('parseSocial pelo cartão sem "Antes" dá precoAntigo null', () => {
  const r = plain(ctx.parseSocial(fx('social-cartao-sem-desconto.html')));
  assert.equal(r.preco, 39.9);
  assert.equal(r.precoAntigo, null);
});

test('parseSocial pelo cartão lê preços com milhar', () => {
  const r = plain(ctx.parseSocial(fx('social-cartao-milhar.html')));
  assert.equal(r.preco, 1299.9);
  assert.equal(r.precoAntigo, 2499);
});

test('sem cartão em destaque, escolhe o cartão com o mesmo título do og:title', () => {
  const r = plain(ctx.parseSocial(fx('social-cartao-sem-destaque.html')));
  assert.equal(r.titulo, 'Boné Ogochi Básico Algodão');
  assert.equal(r.precoAntigo, 67);
  assert.equal(r.itemId, 'MLB6645312468');
});

test('sem destaque e sem cartão do produto, não usa o cartão de outro produto', () => {
  const r = plain(ctx.parseSocial(fx('social-cartao-outro-produto.html')));
  assert.equal(r.titulo, 'Boné Ogochi Básico Algodão');
  assert.equal(r.preco, 39.9);
  assert.equal(r.precoAntigo, null);
  assert.equal(r.itemId, null);
});

// ---- preço no cartão (quando o ML mostra "X% OFF no Pix" e "ou R$ … em Nx") ----

test('parseSocial pelos dados traz o preço no Pix e o total no cartão', () => {
  const r = plain(ctx.parseSocial(fx('social-pix.html')));
  assert.equal(r.preco, 167.5);
  assert.equal(r.precoAntigo, 199.9);
  assert.equal(r.precoCartao, 176.32);
});

test('parseSocial pelo cartão visível traz o total no cartão', () => {
  const r = plain(ctx.parseSocial(fx('social-cartao-pix.html')));
  assert.equal(r.preco, 167.5);
  assert.equal(r.precoCartao, 176.32);
});

test('sem "ou R$ … no cartão", precoCartao é null', () => {
  assert.equal(ctx.parseSocial(fx('social-com-desconto.html')).precoCartao, null);
  assert.equal(ctx.parseSocial(fx('social-cartao.html')).precoCartao, null);
});

test('total no cartão igual ao preço não conta como preço no cartão', () => {
  const html = fx('social-pix.html').replace('"value":176.32', '"value":167.5');
  assert.equal(ctx.parseSocial(html).precoCartao, null);
});

// O ML às vezes escreve as legendas dos preços em espanhol ("Ahora: 94 reales con 90 centavos").
test('cartão com legendas em espanhol traz preço, antigo e cartão ("em outros meios")', () => {
  const r = plain(ctx.parseSocial(fx('social-cartao-espanhol.html')));
  assert.equal(r.preco, 94.9);
  assert.equal(r.precoAntigo, 265);
  assert.equal(r.precoCartao, 99.9);
});
