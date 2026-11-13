// Bot do Telegram (Cloudflare Worker): recebe mensagens encaminhadas, mostra uma prévia
// com botões OK / Desfazer e, ao confirmar, faz commit do data.json no GitHub.
import { computeState, knownPlayers } from '../src/ledger.js';
import { parseMessage, describeEvent, fmtDate } from '../src/parser.js';

const TZ = 'America/Sao_Paulo';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/webhook') return new Response('ok');
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const update = await request.json();
    ctx.waitUntil(handle(update, env).catch((e) => console.error('erro', e?.stack || e)));
    return new Response('ok');
  },
};

// ---------- Telegram ----------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
const say = (env, chat_id, text, extra = {}) => tg(env, 'sendMessage', { chat_id, text, ...extra });

// ---------- GitHub ----------
const gh = (env, path, init = {}) =>
  fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'domino-bot',
      ...(init.headers || {}),
    },
  });

const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64encode = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function readData(env) {
  const r = await gh(env, `contents/data.json?ref=${env.GITHUB_BRANCH || 'main'}`);
  if (!r.ok) throw new Error(`GitHub GET ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}

// Aplica `mutate(data)` e faz commit. Tenta de novo se alguém commitou no meio.
async function commitData(env, message, mutate) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { data, sha } = await readData(env);
    mutate(data);
    const r = await gh(env, 'contents/data.json', {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: b64encode(JSON.stringify(data, null, 1) + '\n'),
        sha,
        branch: env.GITHUB_BRANCH || 'main',
      }),
    });
    if (r.ok) return { data, commit: (await r.json()).commit.sha };
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub PUT ${r.status}: ${await r.text()}`);
  }
  throw new Error('Conflito ao gravar no GitHub. Tente de novo.');
}

// ---------- utilidades ----------
const allowed = (env, id) => String(env.ALLOWED_IDS || '').split(',').map((s) => s.trim()).includes(String(id));

function isoFromUnix(sec) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sec * 1000));
}

function summary(state) {
  const dev = Object.entries(state.owed).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', ') || 'ninguém';
  return `Caixa: R$ ${state.cash} · A receber: R$ ${state.pendingTotal}\nDevem: ${dev}`;
}

// ---------- fluxo ----------
async function handle(update, env) {
  if (update.callback_query) return onCallback(update.callback_query, env);
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private') return; // só conversa privada com você

  const text = msg.text || msg.caption || '';
  if (text.trim() === '/id') return say(env, msg.chat.id, `Seu ID: ${msg.from.id}`);
  if (!allowed(env, msg.from.id)) return say(env, msg.chat.id, 'Sem permissão para usar este bot.');

  if (text.startsWith('/start') || text.startsWith('/ajuda')) {
    return say(env, msg.chat.id,
      'Encaminhe pra mim as mensagens do grupo (WIN/LOS ou "fulano pago").\n' +
      'Eu mostro uma prévia e você confirma com OK.\n\n' +
      'Pagamento de uma lisa específica: "Max pago 25/05"\n' +
      'Pagamento de várias: "Augusto pagou 20 reais"\n\n' +
      'Comandos: /placar · /pendentes · /desfazer (apaga o último lançamento)');
  }
  if (text.startsWith('/placar') || text.startsWith('/pendentes')) {
    const { data } = await readData(env);
    const st = computeState(data);
    if (text.startsWith('/pendentes')) return say(env, msg.chat.id, summary(st));
    const linhas = st.ranking.map((p) => `${p.name}: ${p.wins}V ${p.losses}D (saldo ${p.saldo})`).join('\n');
    return say(env, msg.chat.id, `${linhas}\n\n${summary(st)}`);
  }
  if (text.startsWith('/desfazer')) return undo(env, msg.chat.id);
  if (text.startsWith('/')) return say(env, msg.chat.id, 'Comando não reconhecido. Use /ajuda.');

  // Data: se foi encaminhada, usa a data da mensagem original; senão, a de hoje.
  const when = msg.forward_origin?.date ?? msg.forward_date ?? msg.date;
  const date = isoFromUnix(when);

  const { data } = await readData(env);
  const result = parseMessage(text, { date, valor: data.valor, aliases: data.aliases, known: knownPlayers(data) });

  if (!result.events.length) {
    const why = result.errors.length ? '\n\n' + result.errors.map((e) => `• ${e}`).join('\n') : '';
    return say(env, msg.chat.id, `Não encontrei nenhum jogo ou pagamento nessa mensagem.${why}`);
  }

  const avisos = [];
  for (const e of result.errors) avisos.push(`⚠️ ${e}`);
  if (result.newNames.length) avisos.push(`⚠️ Nome novo: ${result.newNames.join(', ')}. Se for erro de digitação, aperte Desfazer e corrija.`);
  for (const ev of result.events) {
    if (ev.type !== 'game') continue;
    const dup = data.events.some((x) => x.type === 'game' && x.date === ev.date &&
      [...x.win].sort().join() === [...ev.win].sort().join() && [...x.los].sort().join() === [...ev.los].sort().join());
    if (dup) avisos.push(`⚠️ Já existe um jogo igual em ${fmtDate(ev.date)}. Pode ser repetido; confira antes de dar OK.`);
  }

  const id = crypto.randomUUID().slice(0, 8);
  await env.PENDING.put(`p:${id}`, JSON.stringify({ events: result.events, by: msg.from.id }), { expirationTtl: 86400 });

  const corpo = result.events.map((e) => describeEvent(e, data.valor)).join('\n');
  return say(env, msg.chat.id, `Vou registrar:\n\n${corpo}${avisos.length ? '\n\n' + avisos.join('\n') : ''}`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ OK', callback_data: `ok:${id}` }, { text: '↩️ Desfazer', callback_data: `no:${id}` }]] },
  });
}

async function onCallback(cb, env) {
  const chat_id = cb.message.chat.id;
  const message_id = cb.message.message_id;
  if (!allowed(env, cb.from.id)) return tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Sem permissão' });
  const [action, id] = cb.data.split(':');
  const key = `p:${id}`;
  const raw = await env.PENDING.get(key);
  await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id });
  const done = (text) => tg(env, 'editMessageText', { chat_id, message_id, text });

  if (!raw) return done('Essa prévia expirou ou já foi usada. Encaminhe a mensagem de novo.');
  await env.PENDING.delete(key); // evita gravar duas vezes se apertar OK em dobro
  if (action === 'no') return done('↩️ Descartado. Nada foi gravado.');

  const { events } = JSON.parse(raw);
  const batch = `b${Date.now()}`;
  const resumo = events.map((e) => describeEvent(e)).join('\n');
  try {
    const out = await commitData(env, `Dominó: ${events.map(shortLabel).join('; ')}`, (data) => {
      let n = Date.now();
      for (const e of events) data.events.push({ id: `e${n++}`, batch, ...e });
    });
    const st = computeState(out.data);
    await done(`✅ Gravado (commit ${out.commit.slice(0, 7)}).\n\n${resumo}\n\n${summary(st)}\n\nA tabela atualiza em cerca de 1 minuto.`);
  } catch (e) {
    console.error(e);
    await done(`❌ Não consegui gravar: ${e.message}\nEncaminhe a mensagem de novo para tentar outra vez.`);
  }
}

function shortLabel(e) {
  if (e.type === 'game') return `lisa ${fmtDate(e.date)} ${e.win.join('+')} x ${e.los.join('+')}`;
  return `${e.name} pagou ${e.count}x`;
}

async function undo(env, chat_id) {
  try {
    let removidos = [];
    const out = await commitData(env, 'Dominó: desfaz último lançamento', (data) => {
      const last = data.events[data.events.length - 1];
      if (!last || last.batch === 'inicial' || last.batch === 'ajustes') {
        throw new Error('Não há lançamento do bot para desfazer.');
      }
      removidos = data.events.filter((e) => e.batch === last.batch);
      data.events = data.events.filter((e) => e.batch !== last.batch);
    });
    const st = computeState(out.data);
    return say(env, chat_id, `↩️ Desfeito:\n${removidos.map((e) => describeEvent(e)).join('\n')}\n\n${summary(st)}`);
  } catch (e) {
    return say(env, chat_id, `❌ ${e.message}`);
  }
}
