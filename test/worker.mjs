// Simula Telegram + GitHub + KV para testar o fluxo do bot sem rede.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

let repoFile = readFileSync(new URL('./fixture.json', import.meta.url), 'utf8');
let sha = 'sha0';
const sent = [];
const commits = [];
const kv = new Map();

globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const body = init.body ? JSON.parse(init.body) : {};
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
  if (url.includes('api.telegram.org')) {
    sent.push({ method: url.split('/').pop(), ...body });
    return json({ ok: true });
  }
  if (url.includes('api.github.com') && (init.method || 'GET') === 'GET') {
    return json({ content: Buffer.from(repoFile).toString('base64'), sha });
  }
  if (url.includes('api.github.com') && init.method === 'PUT') {
    if (body.sha !== sha) return json({ message: 'conflict' }, 409);
    repoFile = Buffer.from(body.content, 'base64').toString('utf8');
    sha = 'sha' + (commits.length + 1);
    commits.push(body.message);
    return json({ commit: { sha: 'abcdef1234567' } });
  }
  throw new Error('fetch inesperado: ' + url);
};

const env = {
  TELEGRAM_TOKEN: 't', WEBHOOK_SECRET: 's', GITHUB_TOKEN: 'g', GITHUB_REPO: 'u/r', ALLOWED_IDS: '42',
  PENDING: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) },
};
const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const post = async (update, secret = 's') => {
  const res = await worker.fetch(new Request('https://x/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update),
  }), env, ctx);
  await Promise.all(pending.splice(0));
  return res;
};
const last = () => sent[sent.length - 1];
const unix = (iso) => Math.floor(new Date(iso + 'T15:00:00Z').getTime() / 1000);

// segredo errado => 403
assert.equal((await post({}, 'errado')).status, 403);

// usuário sem permissão
await post({ message: { chat: { id: 1, type: 'private' }, from: { id: 99 }, text: 'WIN: Max e Hugo\nLOS: Nildo e Romeu', date: 1 } });
assert.match(last().text, /Sem permissão/);

// mensagem encaminhada do grupo => prévia com botões
await post({ message: { chat: { id: 1, type: 'private' }, from: { id: 42 }, message_id: 7, date: unix('2026-11-13'),
  forward_origin: { type: 'user', date: unix('2026-11-12') }, text: 'WIN: Max e Hugo\nLOS: Nildo e Romeu\nNildo pago' } });
assert.match(last().text, /12\/11\/2026: Max e Hugo venceram Nildo e Romeu/);
assert.match(last().text, /Nildo pagou 1 lisa/);
const btn = last().reply_markup.inline_keyboard[0];
assert.deepEqual(btn.map((b) => b.text), ['✅ OK', '↩️ Desfazer']);
assert.equal(commits.length, 0, 'nada gravado antes do OK');

// Desfazer descarta
await post({ callback_query: { id: 'c1', from: { id: 42 }, data: btn[1].callback_data, message: { chat: { id: 1 }, message_id: 8 } } });
assert.match(last().text, /Descartado/);
assert.equal(commits.length, 0);

// nova prévia, agora OK => commit
await post({ message: { chat: { id: 1, type: 'private' }, from: { id: 42 }, date: unix('2026-11-13'),
  forward_origin: { type: 'user', date: unix('2026-11-12') }, text: 'WIN: Max e Hugo\nLOS: Nildo e Romeu\nNildo pago' } });
const ok = last().reply_markup.inline_keyboard[0][0].callback_data;
await post({ callback_query: { id: 'c2', from: { id: 42 }, data: ok, message: { chat: { id: 1 }, message_id: 9 } } });
assert.equal(commits.length, 1);
assert.match(last().text, /Gravado \(commit abcdef1\)/);
const saved = JSON.parse(repoFile);
assert.equal(saved.events.length, 79 + 2);
assert.equal(saved.events.at(-2).date, '2026-11-12');

// OK apertado de novo não grava em dobro
await post({ callback_query: { id: 'c3', from: { id: 42 }, data: ok, message: { chat: { id: 1 }, message_id: 9 } } });
assert.equal(commits.length, 1);
assert.match(last().text, /expirou/);

// /desfazer remove só o último lançamento do bot
await post({ message: { chat: { id: 1, type: 'private' }, from: { id: 42 }, date: 1, text: '/desfazer' } });
assert.equal(JSON.parse(repoFile).events.length, 79);
assert.match(last().text, /Desfeito/);

// /desfazer de novo não mexe no histórico inicial
await post({ message: { chat: { id: 1, type: 'private' }, from: { id: 42 }, date: 1, text: '/desfazer' } });
assert.match(last().text, /Não há lançamento do bot/);
assert.equal(JSON.parse(repoFile).events.length, 79);

// grupo é ignorado
const n = sent.length;
await post({ message: { chat: { id: -100, type: 'supergroup' }, from: { id: 42 }, text: 'WIN: Max e Hugo\nLOS: Nildo e Romeu', date: 1 } });
assert.equal(sent.length, n);

console.log('Fluxo do bot OK.');
