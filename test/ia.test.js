const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGs } = require('./helpers/load-gs');

const FOTO = 'data:image/jpeg;base64,' + Buffer.from([1, 2, 3]).toString('base64');

// Carrega web/ia.js com um fetch falso: cada chamada consome uma resposta da fila.
function ambiente(fila) {
  const chamadas = [];
  const respostas = (fila || []).slice();
  const fetchFalso = async (url, init) => {
    chamadas.push({ url: String(url), init: init || {} });
    const r = respostas.shift();
    if (!r) throw new Error('sem resposta simulada');
    if (r.abort) { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }
    return new Response(r.body === undefined ? '' : r.body, { status: r.status || 200, headers: r.headers || {} });
  };
  const ctx = loadGs(['web/ia.js'], {
    fetch: fetchFalso, FormData, Blob, Response, AbortController, URL, URLSearchParams,
    atob, btoa, setTimeout, clearTimeout, Promise, Uint8Array, Math, Date,
  });
  ctx.esperar_ = async () => {}; // sem espera de verdade nos testes
  return { ctx, chamadas };
}

const cfg = (provider, key, model) => ({ provider, key: key || '', model: model || '' });
const imagemOk = () => ({ status: 200, headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array([9, 9]) });

// ---- pedidoCena ----

// Desde 2026-11 o Pollinations sem chave responde 403 "Missing Turnstile token" a pedidos de navegador.
test('pollinations sem chave pede a chave grátis sem tentar gerar', () => {
  const { ctx } = ambiente();
  assert.throws(() => ctx.pedidoCena(cfg('pollinations'), 'cozinha clara'), /chave grátis.*enter\.pollinations\.ai/);
});

test('pollinations com chave usa gen.pollinations.ai e Bearer', () => {
  const { ctx } = ambiente();
  const p = ctx.pedidoCena(cfg('pollinations', 'pk_123'), 'sala');
  const u = new URL(p.url);
  assert.equal(u.host, 'gen.pollinations.ai');
  assert.ok(u.pathname.startsWith('/image/'));
  assert.equal(decodeURIComponent(u.pathname), '/image/sala');
  assert.equal(u.searchParams.get('model'), 'zimage');
  assert.equal(u.searchParams.get('width'), '1080');
  assert.equal(u.searchParams.get('height'), '1920');
  assert.equal(u.searchParams.get('nologo'), 'true');
  assert.equal(p.init.method, 'GET');
  assert.equal(p.init.headers.Authorization, 'Bearer pk_123');
});

test('openai gera com gpt-image-1 em 1024x1536', () => {
  const { ctx } = ambiente();
  const p = ctx.pedidoCena(cfg('openai', 'sk-1'), 'quarto');
  assert.equal(p.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(p.init.method, 'POST');
  assert.equal(p.init.headers.Authorization, 'Bearer sk-1');
  assert.deepEqual(JSON.parse(p.init.body), { model: 'gpt-image-1', prompt: 'quarto', size: '1024x1536', n: 1 });
});

test('gemini manda aspectRatio 9:16 e a chave no x-goog-api-key', () => {
  const { ctx } = ambiente();
  const p = ctx.pedidoCena(cfg('gemini', 'AIza-1'), 'jardim');
  assert.equal(p.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent');
  assert.equal(p.init.headers['x-goog-api-key'], 'AIza-1');
  const corpo = JSON.parse(p.init.body);
  assert.deepEqual(corpo.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } });
  assert.deepEqual(corpo.contents, [{ parts: [{ text: 'jardim' }] }]);
});

test('openai e gemini sem chave lançam pedindo a chave', () => {
  const { ctx } = ambiente();
  assert.throws(() => ctx.pedidoCena(cfg('openai'), 'x'), /chave da OpenAI/);
  assert.throws(() => ctx.pedidoCena(cfg('gemini'), 'x'), /Google AI Studio/);
});

// ---- pedidoProduto ----

test('pedidoProduto do pollinations usa images/edits com kontext e a foto', async () => {
  const { ctx } = ambiente();
  const p = ctx.pedidoProduto(cfg('pollinations', 'pk_1'), 'cena', FOTO);
  assert.equal(p.url, 'https://gen.pollinations.ai/v1/images/edits');
  assert.equal(p.init.headers.Authorization, 'Bearer pk_1');
  const fd = p.init.body;
  assert.equal(fd.get('model'), 'kontext');
  assert.equal(fd.get('prompt'), 'cena');
  assert.equal(fd.get('size'), '1024x1536');
  assert.equal(fd.get('n'), '1');
  const foto = fd.get('image');
  assert.equal(foto.type, 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await foto.arrayBuffer())], [1, 2, 3]);
});

test('pedidoProduto da openai usa images/edits com gpt-image-1', () => {
  const { ctx } = ambiente();
  const p = ctx.pedidoProduto(cfg('openai', 'sk-1'), 'cena', FOTO);
  assert.equal(p.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(p.init.body.get('model'), 'gpt-image-1');
});

test('pedidoProduto do gemini manda a foto em inlineData antes do texto', () => {
  const { ctx } = ambiente();
  const p = ctx.pedidoProduto(cfg('gemini', 'AIza-1'), 'cena', FOTO);
  const corpo = JSON.parse(p.init.body);
  assert.deepEqual(corpo.contents[0].parts, [{ inlineData: { mimeType: 'image/jpeg', data: 'AQID' } }, { text: 'cena' }]);
  assert.equal(corpo.generationConfig.imageConfig.aspectRatio, '9:16');
});

test('pedidoProduto sem chave do pollinations lança a mensagem de criar chave grátis', () => {
  const { ctx } = ambiente();
  assert.throws(() => ctx.pedidoProduto(cfg('pollinations'), 'cena', FOTO), /enter\.pollinations\.ai/);
});

test('chave nunca aparece na URL', () => {
  const { ctx } = ambiente();
  for (const prov of ['pollinations', 'openai', 'gemini']) {
    assert.ok(!ctx.pedidoCena(cfg(prov, 'SEGREDO42'), 'x').url.includes('SEGREDO42'), prov + ' cena');
    assert.ok(!ctx.pedidoProduto(cfg(prov, 'SEGREDO42'), 'x', FOTO).url.includes('SEGREDO42'), prov + ' produto');
  }
});

// ---- segundosRetry ----

test('segundosRetry lê "Retry after 31s"', () => {
  const { ctx } = ambiente();
  assert.equal(ctx.segundosRetry('{"error":"FREE_LIMIT. Retry after 31s"}'), 31);
  assert.equal(ctx.segundosRetry('sem número'), null);
});

// ---- lerImagem ----

test('lerImagem devolve a própria resposta quando é imagem', async () => {
  const { ctx } = ambiente();
  const blob = await ctx.lerImagem(new Response(new Uint8Array([7]), { headers: { 'Content-Type': 'image/png' } }));
  assert.equal(blob.type, 'image/png');
});

test('lerImagem lê b64_json do formato OpenAI', async () => {
  const { ctx } = ambiente();
  const r = new Response(JSON.stringify({ data: [{ b64_json: 'AQID' }] }), { headers: { 'Content-Type': 'application/json' } });
  const blob = await ctx.lerImagem(r, 'OpenAI');
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
});

test('lerImagem lê inlineData do Gemini', async () => {
  const { ctx } = ambiente();
  const corpo = { candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/webp', data: 'AQID' } }] } }] };
  const blob = await ctx.lerImagem(new Response(JSON.stringify(corpo), { headers: { 'Content-Type': 'application/json' } }), 'Gemini');
  assert.equal(blob.type, 'image/webp');
});

test('lerImagem sem imagem no Gemini explica o filtro de conteúdo', async () => {
  const { ctx } = ambiente();
  const r = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'não' }] } }] }), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(ctx.lerImagem(r, 'Gemini'), /Gemini não retornou imagem \(o pedido pode ter sido bloqueado pelo filtro de conteúdo\)\./);
});

// ---- gerarImagem ----

test('gerarImagem tenta de novo em 402 e devolve a imagem na segunda', async () => {
  const { ctx, chamadas } = ambiente([{ status: 402, body: 'FREE_LIMIT. Retry after 31s' }, imagemOk()]);
  const blob = await ctx.gerarImagem({ url: 'https://image.pollinations.ai/prompt/x', init: {} }, 'Pollinations');
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(chamadas.length, 2);
});

test('gerarImagem em 401 lança na hora sem tentar de novo', async () => {
  const { ctx, chamadas } = ambiente([{ status: 401, body: '{"error":"bad key"}' }, imagemOk()]);
  await assert.rejects(ctx.gerarImagem({ url: 'https://gen.pollinations.ai/image/x', init: {} }, 'Pollinations'), /Pollinations recusou a chave/);
  assert.equal(chamadas.length, 1);
});

test('gerarImagem desiste quando o retry pedido passa de 60 s', async () => {
  const { ctx, chamadas } = ambiente([{ status: 429, body: 'Retry after 300s' }, imagemOk()]);
  await assert.rejects(ctx.gerarImagem({ url: 'https://image.pollinations.ai/prompt/x', init: {} }, 'Pollinations'));
  assert.equal(chamadas.length, 1);
});

test('gerarImagem para depois de 4 tentativas', async () => {
  const fila = Array(6).fill({ status: 503, body: 'ocupado' });
  const { ctx, chamadas } = ambiente(fila);
  await assert.rejects(ctx.gerarImagem({ url: 'https://image.pollinations.ai/prompt/x', init: {} }, 'Pollinations'));
  assert.equal(chamadas.length, 4);
});

test('gerarImagem traduz erro da API em mensagem com o nome do serviço', async () => {
  const { ctx } = ambiente([{ status: 400, headers: { 'Content-Type': 'application/json' }, body: '{"error":{"message":"prompt inválido"}}' }]);
  await assert.rejects(ctx.gerarImagem({ url: 'https://api.openai.com/v1/images/generations', init: {} }, 'OpenAI'), /OpenAI: prompt inválido/);
});

test('gerarImagem que demora demais avisa para tentar de novo', async () => {
  const { ctx } = ambiente([{ abort: true }]);
  await assert.rejects(ctx.gerarImagem({ url: 'https://api.openai.com/x', init: {} }, 'OpenAI'), /A IA demorou demais para responder\. Tente de novo\./);
});

test('chave recusada mostra o motivo do serviço e diz para colar uma nova', async () => {
  const corpo = '{"success":false,"error":{"message":"A valid API key is required.","code":"UNAUTHORIZED"}}';
  const { ctx } = ambiente([{ status: 401, headers: { 'Content-Type': 'application/json' }, body: corpo }]);
  await assert.rejects(
    ctx.gerarImagem({ url: 'https://gen.pollinations.ai/image/x', init: {} }, 'Pollinations'),
    /Pollinations recusou a chave: A valid API key is required\..*cole uma chave nova/,
  );
});

// ---- sem saldo / sem cota: avisa na hora, sem tentar de novo ----

test('Pollinations sem saldo avisa na hora e não tenta de novo', async () => {
  const corpo = '{"success":false,"error":{"message":"Insufficient balance. This request costs about $0.0300, but your available balance is $0.0000."}}';
  const { ctx, chamadas } = ambiente([{ status: 402, headers: { 'Content-Type': 'application/json' }, body: corpo }, imagemOk()]);
  await assert.rejects(
    ctx.gerarImagem({ url: 'https://gen.pollinations.ai/v1/images/edits', init: {} }, 'Pollinations'),
    /Sua conta do Pollinations está sem saldo.*enter\.pollinations\.ai/,
  );
  assert.equal(chamadas.length, 1);
});

test('OpenAI sem crédito (insufficient_quota) avisa na hora', async () => {
  const corpo = '{"error":{"message":"You exceeded your current quota.","type":"insufficient_quota","code":"insufficient_quota"}}';
  const { ctx, chamadas } = ambiente([{ status: 429, headers: { 'Content-Type': 'application/json' }, body: corpo }, imagemOk()]);
  await assert.rejects(ctx.gerarImagem({ url: 'https://api.openai.com/v1/images/edits', init: {} }, 'OpenAI'), /Sua conta da OpenAI está sem crédito/);
  assert.equal(chamadas.length, 1);
});

test('Gemini com cota esgotada (RESOURCE_EXHAUSTED) avisa na hora', async () => {
  const corpo = '{"error":{"code":429,"message":"You exceeded your current quota.","status":"RESOURCE_EXHAUSTED"}}';
  const { ctx, chamadas } = ambiente([{ status: 429, headers: { 'Content-Type': 'application/json' }, body: corpo }, imagemOk()]);
  await assert.rejects(ctx.gerarImagem({ url: 'https://generativelanguage.googleapis.com/x', init: {} }, 'Gemini'), /A cota do Gemini acabou/);
  assert.equal(chamadas.length, 1);
});
