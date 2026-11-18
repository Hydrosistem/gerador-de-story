const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const web = (n) => fs.readFileSync(path.join(__dirname, '..', 'web', n), 'utf8');
const existe = (n) => fs.existsSync(path.join(__dirname, '..', 'web', n));
const html = existe('index.html') ? web('index.html') : '';

test('página não chama mais rotas /api/ do servidor local', () => {
  assert.ok(html.length > 0, 'web/index.html não existe');
  assert.equal(html.indexOf("'/api/"), -1);
  assert.equal(html.indexOf('"/api/'), -1);
  assert.equal(html.indexOf('localhost:3333'), -1);
});

test('página carrega ia.js e o script do Google', () => {
  assert.match(html, /<script src="ia\.js"><\/script>/);
  assert.match(html, /<script id="scriptGoogle" src="https:\/\/accounts\.google\.com\/gsi\/client" async/);
});

test('API_URL e GOOGLE_CLIENT_ID apontam para o servidor e o login do Story', () => {
  assert.match(html, /var API_URL = 'https:\/\/script\.google\.com\/macros\/s\/AKfycbxym8lbvmn3T_kIQHfFoixeW3SIkDS-qLLs8slx0IzNX-oLf59_gLOUHW3xoTqCgmsYqQ\/exec';/);
  assert.match(html, /var GOOGLE_CLIENT_ID = '577232193037-6c8fkjci9g2c2ggn5do0r1i6grp4c9qa\.apps\.googleusercontent\.com';/);
});

test('tela de login vem antes do app e avisa a política de privacidade', () => {
  const login = html.indexOf('<div id="telaLogin"');
  const app = html.indexOf('<main id="app"');
  assert.ok(login >= 0 && app > login, 'tela de login precisa vir antes do <main id="app">');
  assert.match(html.slice(login, app), /href="privacidade\.html"/);
  assert.ok(existe('privacidade.html'), 'web/privacidade.html não existe');
});

test('sem bookmarklet nem painel da API do Mercado Livre', () => {
  assert.equal(html.indexOf('id="bm"'), -1);
  assert.equal(html.indexOf('id="mlcfg"'), -1);
  assert.equal(html.indexOf('function bookmarklet'), -1);
});

test('chaves de sessão são gs_sessao e gs_nome', () => {
  assert.match(html, /var LS_SESSAO = 'gs_sessao';/);
  assert.match(html, /var LS_NOME = 'gs_nome';/);
});

test('manifest tem nome Gerador de Story e ícones 192 e 512', () => {
  const m = JSON.parse(web('manifest.json'));
  assert.equal(m.name, 'Gerador de Story');
  assert.equal(m.display, 'standalone');
  const tamanhos = m.icons.map((i) => i.sizes).sort();
  assert.deepEqual(tamanhos, ['192x192', '512x512']);
  assert.ok(existe('icon-192.png') && existe('icon-512.png'), 'ícones não existem');
  assert.match(html, /<link rel="manifest" href="manifest\.json">/);
  assert.ok(existe('sw.js'), 'web/sw.js não existe');
});

test('link sem preço avisa para digitar o preço antes de publicar', () => {
  const ini = html.indexOf('async function pullFromLink');
  const fim = html.indexOf('\n}', ini);
  const corpo = html.slice(ini, fim);
  assert.ok(ini >= 0, 'pullFromLink não encontrado');
  assert.match(corpo, /if\(!r\.preco\)status\('Não achei o preço nesse link\. Digite o preço antes de publicar\.',true\)/);
});
