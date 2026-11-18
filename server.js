// Lar de Achadinhos — servidor do gerador de ofertas.
// Sem dependências: precisa apenas do Node.js 18+.
//   node server.js            → no seu PC: abre http://localhost:3333 (sem login)
//   Online (Render etc.)      → defina APP_PASSWORD (e APP_USER) nas variáveis de ambiente: o login fica obrigatório.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3333;
const ONLINE = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.ONLINE);
const HOST = process.env.HOST || (ONLINE ? '0.0.0.0' : '127.0.0.1');
const APP_USER = String(process.env.APP_USER || 'admin').trim().toLowerCase();
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH = !!APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;
const PUBLIC = path.join(__dirname, 'public');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Só busca fotos dos domínios de imagem do Mercado Livre (evita virar um proxy aberto).
const IMG_HOSTS = [/(^|\.)mlstatic\.com$/i, /(^|\.)mercadolivre\.com\.br$/i, /(^|\.)mercadolibre\.com$/i];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Requisição grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- Login ----------
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
const sameText = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const signSession = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');

function newSession() { const v = String(Date.now() + SESSION_DAYS * 864e5); return `${v}.${signSession(v)}`; }
function loggedIn(req) {
  if (!AUTH) return true;
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sess=([^;]+)/);
  if (!m) return false;
  const [v, sig] = m[1].split('.');
  return !!(v && sig && sameText(sig, signSession(v)) && Number(v) > Date.now());
}
function cookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sess=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function clientIp(req) { return (ONLINE && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?'; }

const attempts = new Map(); // ip → { n, until }
async function login(req, res) {
  const ip = clientIp(req), a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return send(res, 429, { error: 'Muitas tentativas. Espere 10 minutos e tente de novo.' });
  let body; try { body = JSON.parse(await readBody(req, 1e4)); } catch { return send(res, 400, { error: 'Pedido inválido.' }); }
  const userOk = sameText(String(body.user || '').trim().toLowerCase(), APP_USER);
  const passOk = sameText(String(body.password || ''), APP_PASSWORD);
  if (!AUTH || !(userOk && passOk)) {
    a.n++; if (a.n >= 8) { a.n = 0; a.until = Date.now() + 10 * 60000; } attempts.set(ip, a);
    await sleep(600);
    return send(res, 401, { error: AUTH ? 'Usuário ou senha incorretos.' : 'Login não está ativado.' });
  }
  attempts.delete(ip);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookie(req, newSession(), SESSION_DAYS * 86400) });
  res.end(JSON.stringify({ ok: true }));
}
function logout(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie(req, '', 0) });
  res.end('{"ok":true}');
}
const PUBLIC_PATHS = new Set(['/login.html', '/api/login', '/api/me', '/favicon.ico']);

async function fetchWithTimeout(url, opts = {}, ms = 120000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

// ---------- Proxy da foto do produto (permite desenhar no canvas e exportar o PNG) ----------
async function proxyImage(res, raw) {
  let u;
  try { u = new URL(raw); } catch { return send(res, 400, { error: 'URL de imagem inválida.' }); }
  if (!/^https?:$/.test(u.protocol) || !IMG_HOSTS.some(rx => rx.test(u.hostname)))
    return send(res, 400, { error: 'Só aceito fotos do Mercado Livre (mlstatic.com).' });
  const r = await fetchWithTimeout(u, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', Referer: 'https://www.mercadolivre.com.br/' } }, 30000);
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) return send(res, 502, { error: `Não consegui baixar a foto (HTTP ${r.status}).` });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 15e6) return send(res, 413, { error: 'Foto grande demais.' });
  send(res, 200, buf, type);
}

// ---------- Geração do cenário por IA ----------
async function genPollinations({ prompt, key, model }) {
  const seed = Math.floor(Math.random() * 1e9);
  const q = new URLSearchParams({ width: '1080', height: '1920', nologo: 'true', seed: String(seed), model: model || (key ? 'zimage' : 'flux') });
  const url = key
    ? `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${q}`
    : `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`;
  const headers = { 'User-Agent': UA };
  if (key) headers.Authorization = `Bearer ${key}`;
  let last = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetchWithTimeout(url, { headers }, 120000);
    const type = r.headers.get('content-type') || '';
    if (r.ok && type.startsWith('image/')) return { buf: Buffer.from(await r.arrayBuffer()), type };
    last = await r.text().catch(() => '');
    if (r.status === 401 || r.status === 403) throw new Error('Pollinations recusou a chave (verifique a chave em enter.pollinations.ai).');
    if (![402, 429].includes(r.status) && r.status < 500) break;
    // Plano grátis: "1 image every 45 seconds per IP. Retry after 31s" → espera o que ele pedir.
    const wait = Number((last.match(/retry after (\d+)\s*s/i) || [])[1]) || 10;
    if (attempt === 3 || wait > 60) break;
    await sleep((wait + 2) * 1000);
  }
  throw new Error('Pollinations está sem vaga na fila gratuita agora. Tente de novo em alguns segundos ou use uma chave/IA paga. ' + short(last));
}

async function genOpenAI({ prompt, key, model }) {
  if (!key) throw new Error('Informe sua chave da OpenAI nas configurações de IA.');
  const r = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || 'gpt-image-1', prompt, size: '1024x1536', n: 1 })
  }, 180000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI: ' + (j.error?.message || `HTTP ${r.status}`));
  const item = j.data?.[0];
  if (item?.b64_json) return { buf: Buffer.from(item.b64_json, 'base64'), type: 'image/png' };
  if (item?.url) { const ir = await fetchWithTimeout(item.url); return { buf: Buffer.from(await ir.arrayBuffer()), type: ir.headers.get('content-type') || 'image/png' }; }
  throw new Error('OpenAI não retornou imagem.');
}

async function genGemini({ prompt, key, model }) {
  if (!key) throw new Error('Informe sua chave do Google AI Studio (Gemini) nas configurações de IA.');
  const m = model || 'gemini-2.5-flash-image';
  const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } }
    })
  }, 180000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gemini: ' + (j.error?.message || `HTTP ${r.status}`));
  const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data || p.inline_data?.data);
  const data = part?.inlineData || part?.inline_data;
  if (!data) throw new Error('Gemini não retornou imagem (o pedido pode ter sido bloqueado pelo filtro de conteúdo).');
  return { buf: Buffer.from(data.data, 'base64'), type: data.mimeType || data.mime_type || 'image/png' };
}

const PROVIDERS = { pollinations: genPollinations, openai: genOpenAI, gemini: genGemini };

// ---------- Produto DENTRO do cenário: a IA recebe a foto do produto e monta a cena com ele ----------
async function imageFromResponse(j, who) {
  const item = j.data?.[0];
  if (item?.b64_json) return { buf: Buffer.from(item.b64_json, 'base64'), type: 'image/png' };
  if (item?.url) { const ir = await fetchWithTimeout(item.url); return { buf: Buffer.from(await ir.arrayBuffer()), type: ir.headers.get('content-type') || 'image/png' }; }
  throw new Error(`${who} não retornou imagem.`);
}

// Formato "images/edits" (OpenAI e Pollinations usam o mesmo).
async function editOpenAIStyle(base, who, { prompt, key, model, image }) {
  const fd = new FormData();
  fd.append('model', model);
  fd.append('prompt', prompt);
  fd.append('image', new Blob([image.buf], { type: image.type }), 'produto.' + (image.type.split('/')[1] || 'png'));
  fd.append('size', '1024x1536');
  fd.append('n', '1');
  const r = await fetchWithTimeout(base + '/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd }, 240000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || j.message || (typeof j.error === 'string' ? j.error : '') || `HTTP ${r.status}`;
    throw new Error(`${who}: ${short(msg)}`);
  }
  return imageFromResponse(j, who);
}

const PRODUCT_SCENE = {
  pollinations: o => {
    if (!o.key) throw new Error('Para colocar o produto dentro do cenário com o Pollinations, crie uma conta grátis em enter.pollinations.ai, gere uma chave e cole em "Configurações da IA".');
    return editOpenAIStyle('https://gen.pollinations.ai', 'Pollinations', { ...o, model: o.model || 'kontext' });
  },
  openai: o => {
    if (!o.key) throw new Error('Informe sua chave da OpenAI nas configurações de IA.');
    return editOpenAIStyle('https://api.openai.com', 'OpenAI', { ...o, model: o.model || 'gpt-image-1' });
  },
  gemini: async ({ prompt, key, model, image }) => {
    if (!key) throw new Error('Informe sua chave do Google AI Studio (Gemini) nas configurações de IA.');
    const m = model || 'gemini-2.5-flash-image';
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: image.type, data: image.buf.toString('base64') } }, { text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } }
      })
    }, 240000);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Gemini: ' + (j.error?.message || `HTTP ${r.status}`));
    const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data || p.inline_data?.data);
    const data = part?.inlineData || part?.inline_data;
    if (!data) throw new Error('Gemini não retornou imagem (o pedido pode ter sido bloqueado pelo filtro de conteúdo).');
    return { buf: Buffer.from(data.data, 'base64'), type: data.mimeType || data.mime_type || 'image/png' };
  }
};

async function productScene(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req, 20e6)); } catch { return send(res, 400, { error: 'Pedido inválido (a foto pode ser grande demais).' }); }
  const prompt = String(body.prompt || '').trim().slice(0, 2500);
  const m = String(body.image || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!prompt || !m) return send(res, 400, { error: 'Falta a foto do produto ou a descrição do cenário.' });
  const gen = PRODUCT_SCENE[body.provider] || PRODUCT_SCENE.pollinations;
  try {
    const { buf, type } = await gen({ prompt, key: String(body.key || '').trim(), model: String(body.model || '').trim(), image: { buf: Buffer.from(m[2], 'base64'), type: m[1] } });
    send(res, 200, buf, type);
  } catch (e) {
    send(res, 502, { error: e.name === 'AbortError' ? 'A IA demorou demais para responder. Tente de novo.' : e.message });
  }
}
const short = s => String(s || '').replace(/\s+/g, ' ').slice(0, 220);

async function background(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Pedido inválido.' }); }
  const prompt = String(body.prompt || '').trim().slice(0, 1800);
  const gen = PROVIDERS[body.provider] || genPollinations;
  if (!prompt) return send(res, 400, { error: 'Descrição do cenário vazia.' });
  try {
    const { buf, type } = await gen({ prompt, key: String(body.key || '').trim(), model: String(body.model || '').trim() });
    send(res, 200, buf, type);
  } catch (e) {
    send(res, 502, { error: e.name === 'AbortError' ? 'A IA demorou demais para responder. Tente de novo.' : e.message });
  }
}

// ---------- Mercado Livre: dados do produto só pelo link (API oficial) ----------
// Usa um app gratuito criado em developers.mercadolivre.com.br (App ID + Chave secreta).
// Token "client_credentials": não precisa de login nem de navegador.
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ML_API = 'https://api.mercadolibre.com';
const ML_LINK_HOSTS = /(^|\.)(mercadolivre\.com(\.br)?|mercadolibre\.com|meli\.la|mercadolivre\.page\.link)$/i;
let token = null; // { value, exp }

function readConfig() {
  let c = {}; try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  // Online, o disco pode ser apagado a cada reinício: as variáveis de ambiente têm prioridade.
  if (process.env.ML_CLIENT_ID) c.mlClientId = process.env.ML_CLIENT_ID;
  if (process.env.ML_CLIENT_SECRET) c.mlClientSecret = process.env.ML_CLIENT_SECRET;
  return c;
}
function writeConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }

async function getToken() {
  if (token && token.exp > Date.now() + 60000) return token.value;
  const { mlClientId, mlClientSecret } = readConfig();
  if (!mlClientId || !mlClientSecret) { const e = new Error('Para link direto de produto é preciso conectar a API do Mercado Livre (App ID e Chave secreta). Ou cole o seu link de afiliado (meli.la), que funciona sem isso.'); e.code = 'NO_CONFIG'; throw e; }
  const r = await fetchWithTimeout(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: mlClientId, client_secret: mlClientSecret })
  }, 20000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error('O Mercado Livre recusou o App ID/Chave secreta: ' + (j.message || `HTTP ${r.status}`)); e.code = 'BAD_CONFIG'; throw e; }
  token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 21600) * 1000 };
  return token.value;
}

async function mlGet(p) {
  const r = await fetchWithTimeout(ML_API + p, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } }, 20000);
  const j = await r.json().catch(() => null);
  if (r.status === 401) token = null;
  if (!r.ok) { const e = new Error(`API ${p} → HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const mlTry = p => mlGet(p).catch(e => { if (e.code) throw e; return null; });

// Lê IDs do produto (catálogo /p/MLB…) e do anúncio (MLB-123…, wid=, item_id:) de uma URL.
function extractIds(raw) {
  let s = raw; try { s = decodeURIComponent(raw); } catch {}
  const product = (s.match(/\/p\/(ML[A-Z]\d{5,})/i) || [])[1];
  const item = (s.match(/(?:wid|item_id)[=:](ML[A-Z]-?\d{6,})/i) || s.match(/\/(ML[A-Z])-?(\d{6,})(?=[-_/?#]|$)/i) || [])
    .slice(1).join('').replace(/^(ML[A-Z])-?/i, '$1').toUpperCase() || null;
  let slugTitle = null;
  const m = s.match(/\/ML[A-Z]-?\d{6,}-([^/?#]+)/i) || s.match(/mercadoli(?:vre|bre)\.com(?:\.br)?\/([^/?#]{12,})\/p\//i);
  if (m) slugTitle = m[1].replace(/_JM$/i, '').replace(/[-_]+/g, ' ').trim();
  const P = product ? product.toUpperCase() : null;
  return { product: P, item: item && /\d/.test(item) && item !== P ? item : null, slugTitle };
}

// Lê um objeto JSON que começa em s[i] === '{'.
function jsonObjectAt(s, i) {
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; } }
  }
  return null;
}
const decodeHtml = t => String(t || '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Link de afiliado (meli.la / mercadolivre.com/sec) abre a vitrine do afiliado (/social/...),
// que traz o produto compartilhado em destaque, com título, preços e foto.
function parseSocialPage(html) {
  const shared = (html.match(/"shared_item":\{"id":"(ML[A-Z]\d+)"/) || [])[1];
  let card = null;
  if (shared) {
    const at = html.indexOf(`"metadata":{"id":"${shared}"`);
    const start = at > 0 ? html.lastIndexOf('{"unique_id"', at) : -1;
    if (start >= 0) card = jsonObjectAt(html, start);
  }
  if (!card) { const k = html.indexOf('"polycards":[{'); if (k >= 0) card = jsonObjectAt(html, k + '"polycards":['.length); }
  const comp = type => (card?.components || []).find(c => c.type === type)?.[type];
  const og = p => decodeHtml((html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`)) || [])[1]);

  let title = comp('title')?.text || '';
  const price = comp('price') || {};
  let current = Number(price.current_price?.value) || 0;
  const previous = Number(price.previous_price?.value) || 0;
  const picId = card?.pictures?.pictures?.[0]?.id;
  let image = picId ? `https://http2.mlstatic.com/D_NQ_NP_2X_${picId}-F.webp` : '';

  // Plano B: as tags de compartilhamento ("Nome - R$ 39,90" e a foto).
  const ogTitle = og('title');
  if (!title && ogTitle) title = ogTitle.replace(/\s+-\s+R\$\s*[\d.,]+\s*$/, '');
  if (!current && ogTitle) { const m = ogTitle.match(/R\$\s*([\d.]+(?:,\d{2})?)\s*$/); if (m) current = Number(m[1].replace(/\./g, '').replace(',', '.')); }
  if (!image && og('image')) image = og('image').replace(/-[A-Z]\.(webp|jpg|png)$/i, '-F.$1');

  const id = card?.metadata?.id || shared;
  const domain = id ? (html.match(new RegExp(`"id":"${id}","category_id":"[^"]*","domain_id":"ML[A-Z]-([A-Z_]+)"`)) || [])[1] : '';
  if (!title && !current) return null;
  return { title, price: current, old: previous > current ? previous : 0, image, category: (domain || '').replace(/_/g, ' '), itemId: id || null, source: 'vitrine' };
}

// Segue os redirecionamentos do link curto de afiliado só pelos cabeçalhos (não abre a página final).
async function resolveLink(link) {
  let url = link;
  for (let hop = 0; hop < 8; hop++) {
    const ids = extractIds(url);
    if (ids.product || ids.item) return { url, ...ids };
    let u; try { u = new URL(url); } catch { break; }
    const go = u.searchParams.get('go'); // tela de login do ML guarda o destino em ?go=
    if (go) { url = go; continue; }
    if (!ML_LINK_HOSTS.test(u.hostname)) break;
    const r = await fetchWithTimeout(url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html' } }, 15000);
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { r.body?.cancel?.(); url = new URL(loc, url).href; continue; }
    const html = (await r.text().catch(() => '')).slice(0, 3e6);
    if (r.ok && /^\/social\//.test(new URL(url).pathname)) {
      const social = parseSocialPage(html);
      if (social) return { url, social, ...extractIds(url) };
    }
    // Alguns links curtos respondem 200 com o destino no HTML (meta refresh / canonical).
    const found = html.match(/https?:\\?\/\\?\/(?:www\.|produto\.|articulo\.)?mercadoli(?:vre|bre)\.com(?:\.br)?[^"'\s<>]*ML[A-Z]-?\d{6,}[^"'\s<>]*/i);
    if (found) { url = found[0].replace(/\\\//g, '/').replace(/&amp;/g, '&'); continue; }
    break;
  }
  return { url, ...extractIds(url) };
}

const bigPic = u => String(u || '').replace(/^http:/, 'https:').replace(/-[A-Z]\.(jpg|webp|png)$/i, '-F.$1');

async function fromProduct(pid, itemId) {
  const [p, list] = await Promise.all([mlTry(`/products/${pid}`), mlTry(`/products/${pid}/items`)]);
  if (!p) return null;
  const items = list?.results || [];
  const chosen = items.find(i => i.item_id === itemId) || items.slice().sort((a, b) => a.price - b.price)[0];
  const bw = p.buy_box_winner || {};
  return {
    title: p.name, image: bigPic(p.pictures?.[0]?.url || p.pictures?.[0]?.secure_url),
    price: chosen?.price || bw.price || 0, old: chosen?.original_price || bw.original_price || 0,
    category: (p.domain_id || '').replace(/^ML[A-Z]-/, '').replace(/_/g, ' '),
    hasItem: !!items.find(i => i.item_id === itemId)
  };
}

async function fetchOffer(link) {
  let u; try { u = new URL(link.trim()); } catch { throw new Error('Isso não parece um link. Cole o link completo, começando com https://'); }
  if (!ML_LINK_HOSTS.test(u.hostname)) throw new Error('Esse link não é do Mercado Livre.');
  const ids = await resolveLink(u.href);
  if (ids.social) return ids.social; // link de afiliado: dados vêm da vitrine, sem precisar de chave
  if (!ids.product && !ids.item) throw new Error('Não consegui identificar o produto nesse link. Abra o link no navegador, copie o endereço da página do produto e cole aqui.');
  const warn = [];

  // 1) Anúncio direto (funciona só para alguns apps; o ML costuma bloquear anúncios de terceiros).
  if (ids.item && !ids.product) {
    const it = await mlTry(`/items/${ids.item}`);
    if (it?.title) {
      if (it.catalog_product_id) { const pr = await fromProduct(it.catalog_product_id, ids.item); if (pr) return { ...pr, title: it.title, price: it.price || pr.price, old: it.original_price || pr.old, source: 'api' }; }
      return { title: it.title, price: it.price, old: it.original_price || 0, image: bigPic(it.pictures?.[0]?.secure_url || it.thumbnail), category: (it.domain_id || '').replace(/^ML[A-Z]-/, '').replace(/_/g, ' '), source: 'api' };
    }
  }
  // 2) Página de catálogo (/p/MLB…): nome, foto e preço do anúncio.
  if (ids.product) {
    const pr = await fromProduct(ids.product, ids.item);
    if (pr) return { ...pr, source: 'catalogo' };
  }
  // 3) Anúncio fora do /p/: acha o produto de catálogo pelo título e confere se o anúncio está nele.
  let title = ids.slugTitle;
  if (!title && ids.item) {
    const d = await mlTry(`/items/${ids.item}/description`);
    const first = String(d?.plain_text || '').split('\n').map(s => s.trim()).find(s => s.length >= 10 && s.length <= 150);
    if (first) title = first;
  }
  if (title && ids.item) {
    const res = await mlTry(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(title)}`);
    for (const p of (res?.results || []).slice(0, 6)) {
      const pr = await fromProduct(p.id, ids.item);
      if (pr?.hasItem) return { ...pr, source: 'catalogo' };
    }
  }
  if (title) {
    warn.push('Este anúncio não está no catálogo do Mercado Livre, então a API não informa preço nem foto. Preencha o preço e envie a foto.');
    return { title: title.charAt(0).toUpperCase() + title.slice(1), price: 0, old: 0, image: '', category: '', source: 'link', warn };
  }
  throw new Error('O Mercado Livre não liberou os dados desse anúncio pela API.');
}

async function offer(req, res, link) {
  try {
    const d = await fetchOffer(link || '');
    send(res, 200, { ...d, url: link });
  } catch (e) {
    send(res, e.code === 'NO_CONFIG' || e.code === 'BAD_CONFIG' ? 412 : 422, { error: e.name === 'AbortError' ? 'O Mercado Livre demorou para responder. Tente de novo.' : e.message, code: e.code || 'FAIL' });
  }
}

async function config(req, res) {
  if (req.method === 'GET') { const c = readConfig(); return send(res, 200, { mlConfigured: !!(c.mlClientId && c.mlClientSecret), mlClientId: c.mlClientId || '' }); }
  let body; try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Pedido inválido.' }); }
  const c = readConfig();
  c.mlClientId = String(body.mlClientId || '').trim();
  if (body.mlClientSecret) c.mlClientSecret = String(body.mlClientSecret).trim();
  writeConfig(c); token = null;
  try { await getToken(); send(res, 200, { ok: true }); }
  catch (e) { send(res, 400, { error: e.message }); }
}

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/login' && req.method === 'POST') return await login(req, res);
    if (url.pathname === '/api/logout' && req.method === 'POST') return logout(req, res);
    if (url.pathname === '/api/me') return send(res, 200, { auth: AUTH, logged: loggedIn(req), user: AUTH && loggedIn(req) ? APP_USER : null });
    if (!PUBLIC_PATHS.has(url.pathname) && !loggedIn(req)) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Sua sessão expirou. Entre de novo.' });
      res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (url.pathname === '/login.html' && (!AUTH || loggedIn(req))) { res.writeHead(302, { Location: '/' }); return res.end(); }
    if (url.pathname === '/api/img' && req.method === 'GET') return await proxyImage(res, url.searchParams.get('url') || '');
    if (url.pathname === '/api/background' && req.method === 'POST') return await background(req, res);
    if (url.pathname === '/api/scene-product' && req.method === 'POST') return await productScene(req, res);
    if (url.pathname === '/api/oferta' && req.method === 'GET') return await offer(req, res, url.searchParams.get('url'));
    if (url.pathname === '/api/config') return await config(req, res);
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true });
    if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido.' });

    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Proibido', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
      send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
    });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

const LOCAL_ONLY = HOST === '127.0.0.1' || HOST === 'localhost';
if (!LOCAL_ONLY && !AUTH) {
  console.error('\n  ✋ Online o login é obrigatório. Defina a variável de ambiente APP_PASSWORD (e, se quiser, APP_USER) e reinicie.\n');
  process.exit(1);
}
if (AUTH && !process.env.SESSION_SECRET) console.log('  (Dica: defina SESSION_SECRET para não precisar entrar de novo a cada reinício do servidor.)');

server.listen(PORT, HOST, () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`\n  🏠 Lar de Achadinhos — gerador rodando em ${LOCAL_ONLY ? addr : `${HOST}:${PORT}`}${AUTH ? ` (login: ${APP_USER})` : ''}\n  Deixe esta janela aberta enquanto usa. Para parar: Ctrl+C\n`);
  if (LOCAL_ONLY && !ONLINE && !process.env.NO_OPEN && !process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${addr}"` : process.platform === 'darwin' ? `open "${addr}"` : `xdg-open "${addr}"`;
    exec(cmd, () => {});
  }
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log(`\n  A porta ${PORT} já está em uso — o gerador provavelmente já está aberto em http://localhost:${PORT}\n`);
  else console.error(e);
});
