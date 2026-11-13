// Lê o texto de uma mensagem do grupo e devolve eventos (jogos e pagamentos).

const STOP = new Set([
  'e', 'x', 'vs', 'win', 'los', 'lose', 'loser', 'losers', 'winner', 'winners',
  'ganho', 'ganhou', 'ganharam', 'perdeu', 'perderam', 'dupla',
]);
const WIN_RE = /^\s*(win|winner|winners|ganhou|ganharam)\s*:\s*(.*)$/i;
const LOS_RE = /^\s*(los|lose|loser|losers|perdeu|perderam)\s*:\s*(.*)$/i;
const PAY_RE = /\b(pago|paga|pagou|pagaram)\b/i;

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function resolver(known, aliases) {
  const map = new Map();
  for (const n of known) map.set(plain(n), n);
  for (const [k, v] of Object.entries(aliases || {})) map.set(plain(k), v);
  return (tok) => {
    const key = plain(tok);
    if (map.has(key)) return { name: map.get(key), isNew: false };
    return { name: title(tok), isNew: true };
  };
}

function extractNames(text, resolve, news) {
  const out = [];
  for (const tok of text.split(/[^A-Za-zÀ-ÿ]+/)) {
    if (!tok || STOP.has(tok.toLowerCase())) continue;
    const r = resolve(tok);
    if (r.isNew) news.add(r.name);
    out.push(r.name);
  }
  return out;
}

const isoDate = (d, m, y, fallbackYear) => {
  const yy = y ? (y.length === 2 ? '20' + y : y) : String(fallbackYear);
  return `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/**
 * @param {string} text  texto da mensagem
 * @param {{date:string, valor:number, aliases:object, known:string[]}} ctx  date = AAAA-MM-DD da mensagem original
 */
export function parseMessage(text, ctx) {
  const valor = ctx.valor ?? 10;
  const resolve = resolver(ctx.known || [], ctx.aliases);
  const news = new Set();
  const events = [];
  const errors = [];
  let win = null;
  let los = null;
  let winBad = false;
  let losBad = false;
  const year = Number(ctx.date.slice(0, 4));

  const flush = () => {
    if (win && los) {
      events.push({ type: 'game', date: ctx.date, win, los });
      win = los = null;
    }
  };

  for (let raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/^\[[^\]]+\]\s*[^:]{1,30}:\s*/, '').trim(); // tira "[data, hora] Fulano:" colado de exportação
    if (!line) continue;

    let m;
    if ((m = WIN_RE.exec(line))) {
      const names = extractNames(m[2], resolve, news);
      if (names.length !== 2) { errors.push(`WIN precisa de 2 nomes, achei ${names.length}: "${m[2].trim()}"`); winBad = true; continue; }
      win = names; flush(); continue;
    }
    if ((m = LOS_RE.exec(line))) {
      const names = extractNames(m[2], resolve, news);
      if (names.length !== 2) { errors.push(`LOS precisa de 2 nomes, achei ${names.length}: "${m[2].trim()}"`); losBad = true; continue; }
      los = names; flush(); continue;
    }
    if ((m = PAY_RE.exec(line))) {
      let before = line.slice(0, m.index);
      let after = line.slice(m.index + m[0].length);
      let gameDate;
      const dm = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(line);
      if (dm) {
        gameDate = isoDate(dm[1], dm[2], dm[3], year);
        before = before.replace(dm[0], ' ');
        after = after.replace(dm[0], ' ');
      }
      const am = /(\d+)/.exec(after);
      const count = am ? Math.max(1, Math.round(Number(am[1]) / valor)) : 1;
      const names = extractNames(before, resolve, news);
      if (!names.length) { errors.push(`Pagamento sem nome: "${line}"`); continue; }
      for (const name of names) {
        const ev = { type: 'pay', date: ctx.date, name, count };
        if (gameDate) ev.gameDate = gameDate;
        events.push(ev);
      }
      continue;
    }
    errors.push(`Não entendi a linha: "${line}"`);
  }
  if (win && !los && !losBad) errors.push('Faltou a linha LOS');
  if (los && !win && !winBad) errors.push('Faltou a linha WIN');
  return { events, errors, newNames: [...news] };
}

export function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function describeEvent(ev, valor = 10) {
  if (ev.type === 'game') {
    return `🎲 ${fmtDate(ev.date)}: ${ev.win.join(' e ')} venceram ${ev.los.join(' e ')} (cada perdedor deve R$ ${valor})`;
  }
  const alvo = ev.gameDate ? ` (lisa de ${fmtDate(ev.gameDate)})` : '';
  return `💰 ${ev.name} pagou ${ev.count} lisa${ev.count > 1 ? 's' : ''} = R$ ${ev.count * valor}${alvo}`;
}
