import { fmtDate } from './parser.js';

const byName = (a, b) => a.localeCompare(b, 'pt-BR');
const brl = (v) => v.toFixed(2).replace('.', ',');

export function renderBody(state) {
  const caixa = `<h1>R$ ${brl(state.cash)}</h1>`;

  // Ordem padrão: alfabética. A página permite reordenar por vitórias, derrotas ou saldo (clique no título da coluna).
  const placar = [...state.ranking]
    .sort((x, y) => byName(x.name, y.name))
    .map((p) => {
      const cls = p.saldo > 0 ? 'saldo-positivo' : p.saldo < 0 ? 'saldo-negativo' : 'saldo-neutro';
      return `                <tr data-nome="${p.name}" data-v="${p.wins}" data-d="${p.losses}" data-s="${p.saldo}"><td>${p.name}</td><td class="text-center">${p.wins}</td><td class="text-center">${p.losses}</td><td class="text-right ${cls}">${p.saldo}</td></tr>`;
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

  const nomes = Object.keys(state.owedDetail).sort(byName);
  const pendentes = nomes.length
    ? nomes
        .map((n) => {
          const datas = state.owedDetail[n].map((d) => fmtDate(d).slice(0, 5)).join(', ');
          return `                <tr>\n                    <td><strong>${n}</strong></td>\n                    <td class="valor-devido">R$ ${brl(state.owedDetail[n].length * state.valor)}</td>\n                    <td class="datas-pendentes">(${datas})</td>\n                </tr>`;
        })
        .join('\n')
    : '                <tr><td colspan="3" class="text-center">Nenhuma pendência</td></tr>';

  return { caixa, placar, pendentes, historico };
}

export function renderHtml(template, state) {
  const { caixa, placar, pendentes, historico } = renderBody(state);
  return template
    .replace('<!--CAIXA-->', () => caixa)
    .replace('<!--PLACAR-->', () => placar)
    .replace('<!--PENDENTES-->', () => pendentes)
    .replace('<!--HISTORICO-->', () => historico);
}
