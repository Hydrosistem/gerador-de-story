// Cenário com IA direto do navegador, com a chave guardada neste aparelho (nunca passa pelo servidor).
// Pollinations, Gemini e OpenAI aceitam chamadas do navegador (CORS conferido em 2026-11-18).
// Script comum: as funções ficam globais para a página e para os testes (test/ia.test.js).

var IA_TEMPO_MAX_ = 240000;
var IA_TENTATIVAS_ = 4;

var IA_SEM_CHAVE_ = {
  openai: 'Informe sua chave da OpenAI nas configurações de IA.',
  gemini: 'Informe sua chave do Google AI Studio (Gemini) nas configurações de IA.',
  pollinationsProduto: 'Para colocar o produto dentro do cenário com o Pollinations, crie uma conta grátis em enter.pollinations.ai, gere uma chave e cole em "Configurações da IA".',
  // Sem chave, o Pollinations exige uma verificação anti-robô (Turnstile) que o gerador não tem como fazer.
  pollinations: 'O Pollinations precisa de uma chave grátis: entre em enter.pollinations.ai (com Google ou GitHub), crie uma chave em Keys e cole em "Configurações da IA".'
};

function esperar_(ms) {
  return new Promise(function (ok) { setTimeout(ok, ms); });
}

function iaTexto_(v) {
  return String(v || '').trim();
}

function iaGemini_(cfg, partes) {
  var modelo = iaTexto_(cfg.model) || 'gemini-2.5-flash-image';
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': iaTexto_(cfg.key) },
      body: JSON.stringify({
        contents: [{ parts: partes }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } }
      })
    }
  };
}

// Cena sem o produto (o produto entra recortado por cima depois).
function pedidoCena(cfg, prompt) {
  var chave = iaTexto_(cfg.key), modelo = iaTexto_(cfg.model);
  if (cfg.provider === 'openai') {
    if (!chave) throw new Error(IA_SEM_CHAVE_.openai);
    return {
      url: 'https://api.openai.com/v1/images/generations',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
        body: JSON.stringify({ model: modelo || 'gpt-image-1', prompt: prompt, size: '1024x1536', n: 1 })
      }
    };
  }
  if (cfg.provider === 'gemini') {
    if (!chave) throw new Error(IA_SEM_CHAVE_.gemini);
    return iaGemini_(cfg, [{ text: prompt }]);
  }
  if (!chave) throw new Error(IA_SEM_CHAVE_.pollinations);
  var q = new URLSearchParams({
    width: '1080', height: '1920', nologo: 'true',
    seed: String(Math.floor(Math.random() * 1e9)),
    model: modelo || 'zimage'
  });
  return {
    url: 'https://gen.pollinations.ai/image/' + encodeURIComponent(prompt) + '?' + q.toString(),
    init: { method: 'GET', headers: { Authorization: 'Bearer ' + chave } }
  };
}

function iaFotoParaBlob_(dataUrl) {
  var m = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Falta a foto do produto.');
  var bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: m[1] }), mime: m[1], base64: m[2] };
}

function iaEdicao_(base, chave, modelo, prompt, foto) {
  var fd = new FormData();
  fd.append('model', modelo);
  fd.append('prompt', prompt);
  fd.append('image', foto.blob, 'produto.' + (foto.mime.split('/')[1] || 'png'));
  fd.append('size', '1024x1536');
  fd.append('n', '1');
  return { url: base + '/v1/images/edits', init: { method: 'POST', headers: { Authorization: 'Bearer ' + chave }, body: fd } };
}

// Cena com o produto DENTRO dela: a IA recebe a foto (já enquadrada em 9:16 pela página).
function pedidoProduto(cfg, prompt, fotoDataUrl) {
  var chave = iaTexto_(cfg.key), modelo = iaTexto_(cfg.model);
  if (cfg.provider === 'openai') {
    if (!chave) throw new Error(IA_SEM_CHAVE_.openai);
    return iaEdicao_('https://api.openai.com', chave, modelo || 'gpt-image-1', prompt, iaFotoParaBlob_(fotoDataUrl));
  }
  if (cfg.provider === 'gemini') {
    if (!chave) throw new Error(IA_SEM_CHAVE_.gemini);
    var foto = iaFotoParaBlob_(fotoDataUrl);
    return iaGemini_(cfg, [{ inlineData: { mimeType: foto.mime, data: foto.base64 } }, { text: prompt }]);
  }
  if (!chave) throw new Error(IA_SEM_CHAVE_.pollinationsProduto);
  return iaEdicao_('https://gen.pollinations.ai', chave, modelo || 'kontext', prompt, iaFotoParaBlob_(fotoDataUrl));
}

// Plano grátis do Pollinations: "1 image every 45 seconds per IP. Retry after 31s".
function segundosRetry(texto) {
  var m = /retry after (\d+)\s*s/i.exec(String(texto || ''));
  return m ? Number(m[1]) : null;
}

function iaCurto_(s) {
  return String(s || '').replace(/\s+/g, ' ').slice(0, 220);
}

function iaBase64ParaBlob_(b64, mime) {
  var bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Lê a imagem de qualquer formato de resposta: imagem direta, OpenAI/Pollinations (data[0]) ou Gemini.
async function lerImagem(resp, quem) {
  var tipo = resp.headers.get('content-type') || '';
  if (tipo.indexOf('image/') === 0) return await resp.blob();
  var j = await resp.json().catch(function () { return {}; });
  var item = j && j.data && j.data[0];
  if (item && item.b64_json) return iaBase64ParaBlob_(item.b64_json, 'image/png');
  if (item && item.url) return await (await fetch(item.url)).blob();
  var partes = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  for (var i = 0; i < partes.length; i++) {
    var d = partes[i].inlineData || partes[i].inline_data;
    if (d && d.data) return iaBase64ParaBlob_(d.data, d.mimeType || d.mime_type || 'image/png');
  }
  if (quem === 'Gemini') throw new Error('Gemini não retornou imagem (o pedido pode ter sido bloqueado pelo filtro de conteúdo).');
  throw new Error((quem || 'A IA') + ' não retornou imagem.');
}

function iaMensagemErro_(quem, texto, status) {
  var msg = '';
  try {
    var j = JSON.parse(texto);
    msg = (j.error && j.error.message) || j.message || (typeof j.error === 'string' ? j.error : '');
  } catch (e) {
    msg = texto;
  }
  return quem + ': ' + iaCurto_(msg || 'HTTP ' + status);
}

// Faz o pedido com tempo máximo e novas tentativas quando o serviço está sem vaga (402/429/5xx).
async function gerarImagem(pedido, quem) {
  var ultimo = '';
  for (var tentativa = 0; tentativa < IA_TENTATIVAS_; tentativa++) {
    var controle = new AbortController();
    var timer = setTimeout(function () { controle.abort(); }, IA_TEMPO_MAX_);
    var r;
    try {
      r = await fetch(pedido.url, Object.assign({}, pedido.init, { signal: controle.signal }));
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('A IA demorou demais para responder. Tente de novo.');
      throw new Error(quem + ': não consegui conectar. Confira a internet e tente de novo.');
    } finally {
      clearTimeout(timer);
    }
    if (r.ok) return await lerImagem(r, quem);
    ultimo = await r.text().catch(function () { return ''; });
    if (r.status === 401 || r.status === 403) throw new Error(quem + ' recusou a chave (confira a chave nas Configurações da IA).');
    if (r.status !== 402 && r.status !== 429 && r.status < 500) throw new Error(iaMensagemErro_(quem, ultimo, r.status));
    var espera = segundosRetry(ultimo) || 10;
    if (tentativa === IA_TENTATIVAS_ - 1 || espera > 60) break;
    await esperar_((espera + 2) * 1000);
  }
  if (quem === 'Pollinations') {
    throw new Error('Pollinations está sem vaga na fila gratuita agora. Tente de novo em alguns segundos ou use uma chave/IA paga. ' + iaCurto_(ultimo));
  }
  throw new Error(quem + ' está ocupado agora. Tente de novo em alguns segundos. ' + iaCurto_(ultimo));
}
