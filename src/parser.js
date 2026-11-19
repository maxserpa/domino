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

const pad = (n) => String(n).padStart(2, '0');

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Converte dia/mês[/ano] em AAAA-MM-DD. Sem ano: usa o ano de refIso. Só volta um ano se a data
// ficaria a mais de ~6 meses no futuro (ex.: "28/12" digitado em janeiro); datas próximas no futuro
// são devolvidas como estão, e quem chama avisa que é futuro.
// Devolve null se a data não existir (ex.: 31/02).
export function parseDateText(d, m, y, refIso) {
  const day = Number(d);
  const mon = Number(m);
  const build = (year) => {
    const iso = `${year}-${pad(mon)}-${pad(day)}`;
    const chk = new Date(iso + 'T12:00:00Z');
    return chk.getUTCMonth() + 1 === mon && chk.getUTCDate() === day ? iso : null;
  };
  if (y) return build(y.length === 2 ? 2000 + Number(y) : Number(y));
  const refYear = Number(refIso.slice(0, 4));
  const iso = build(refYear);
  return iso && iso > addDays(refIso, 180) ? build(refYear - 1) : iso;
}

const DATE_PREFIX_RE = /^\s*(?:dia|data)\s*:?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[-–—:,]?\s*(.*)$/i;
const DATE_ONLY_RE = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*$/;
const REL_DATE_RE = /^\s*(hoje|ontem|anteontem)\s*$/i;

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
  let dateOverride = null; // data escrita no texto ("dia 16/11", "ontem")

  const flush = () => {
    if (win && los) {
      events.push({ type: 'game', date: null, win, los });
      win = los = null;
    }
  };

  for (let raw of String(text || '').split(/\r?\n/)) {
    let line = raw.replace(/^\[[^\]]+\]\s*[^:]{1,30}:\s*/, '').trim(); // tira "[data, hora] Fulano:" colado de exportação
    if (!line) continue;

    const setDate = (iso) => {
      if (!iso) errors.push(`Data inválida em: "${raw.trim()}"`);
      else if (iso > ctx.date) errors.push(`Data no futuro: "${raw.trim()}"`);
      else dateOverride = iso;
    };
    let m;
    if ((m = DATE_PREFIX_RE.exec(line))) {
      setDate(parseDateText(m[1], m[2], m[3], ctx.date));
      line = m[4].trim();
      if (!line) continue;
    } else if ((m = DATE_ONLY_RE.exec(line))) {
      setDate(parseDateText(m[1], m[2], m[3], ctx.date));
      continue;
    } else if ((m = REL_DATE_RE.exec(line))) {
      const back = { hoje: 0, ontem: 1, anteontem: 2 }[m[1].toLowerCase()];
      dateOverride = addDays(ctx.date, -back);
      continue;
    }

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
        gameDate = parseDateText(dm[1], dm[2], dm[3], ctx.date);
        if (!gameDate) { errors.push(`Data inválida em: "${line}"`); continue; }
        before = before.replace(dm[0], ' ');
        after = after.replace(dm[0], ' ');
      }
      const am = /(\d+)/.exec(after);
      const count = am ? Math.max(1, Math.round(Number(am[1]) / valor)) : 1;
      const names = extractNames(before, resolve, news);
      if (!names.length) { errors.push(`Pagamento sem nome: "${line}"`); continue; }
      for (const name of names) {
        const ev = { type: 'pay', date: null, name, count };
        if (gameDate) ev.gameDate = gameDate;
        events.push(ev);
      }
      continue;
    }
    errors.push(`Não entendi a linha: "${line}"`);
  }
  if (win && !los && !losBad) errors.push('Faltou a linha LOS');
  if (los && !win && !winBad) errors.push('Faltou a linha WIN');
  const date = dateOverride || ctx.date;
  for (const ev of events) ev.date = date;
  return { events, errors, newNames: [...news], date, explicitDate: dateOverride !== null };
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
