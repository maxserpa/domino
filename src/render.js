import { fmtDate } from './parser.js';

const byName = (a, b) => a.localeCompare(b, 'pt-BR');
const brl = (v) => v.toFixed(2).replace('.', ',');

export function renderBody(state) {
  const caixa = `<h1>R$ ${brl(state.cash)}</h1>`;

  const placar = state.ranking
    .map((p) => {
      const cls = p.saldo > 0 ? 'saldo-positivo' : p.saldo < 0 ? 'saldo-negativo' : 'saldo-neutro';
      return `                <tr><td>${p.name}</td><td class="text-center">${p.wins}</td><td class="text-center">${p.losses}</td><td class="text-right ${cls}">${p.saldo}</td></tr>`;
    })
    .join('\n');

  const ordered = [...state.games].sort((a, b) => (a.date === b.date ? b.idx - a.idx : a.date < b.date ? 1 : -1));
  const historico = ordered
    .map((g) => {
      const w = [...g.win].sort(byName).map((n) => `                        <span class="winner-name">${n}</span>`).join('\n');
      const l = [...g.los]
        .sort((a, b) => byName(a.name, b.name))
        .map((s) => `                        <div class="player-status">${s.name} <span class="${s.paid ? 'badge-pago' : 'badge-pendente'}">${s.paid ? 'Pago' : 'Pendente'}</span></div>`)
        .join('\n');
      return `                <tr>\n                    <td>${fmtDate(g.date)}</td>\n                    <td>\n${w}\n                    </td>\n                    <td>\n${l}\n                    </td>\n                </tr>`;
    })
    .join('\n');

  return { caixa, placar, historico };
}

export function renderHtml(template, state) {
  const { caixa, placar, historico } = renderBody(state);
  return template
    .replace('<!--CAIXA-->', caixa)
    .replace('<!--PLACAR-->', placar)
    .replace('<!--HISTORICO-->', historico);
}
