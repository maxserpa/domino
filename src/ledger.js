// Calcula o estado (placar, caixa, pendências) a partir de data.json.
// Regra: cada pagamento quita a lisa mais antiga em aberto da pessoa
// (ou a lisa de uma data específica, quando o pagamento tem gameDate).
// Pagamento feito antes de a pessoa perder vira crédito e abate a próxima lisa.

export function computeState(data) {
  const valor = data.valor ?? 10;
  const games = [];
  const wins = {};
  const losses = {};
  const pending = {};
  const credit = {};
  let payCount = 0;
  const warnings = [];

  for (const ev of data.events) {
    if (ev.type === 'game') {
      const g = {
        id: ev.id,
        date: ev.date,
        win: [...ev.win],
        los: ev.los.map((name) => ({ name, paid: false })),
        idx: games.length,
      };
      games.push(g);
      for (const n of g.win) wins[n] = (wins[n] || 0) + 1;
      for (const slot of g.los) {
        losses[slot.name] = (losses[slot.name] || 0) + 1;
        if ((credit[slot.name] || 0) > 0) {
          credit[slot.name]--;
          slot.paid = true;
        } else {
          (pending[slot.name] ||= []).push({ g, slot });
        }
      }
    } else if (ev.type === 'pay') {
      const count = ev.count ?? 1;
      payCount += count;
      let left = count;
      const q = pending[ev.name] || [];
      while (left > 0 && q.length) {
        let i = 0;
        if (ev.gameDate) {
          i = q.findIndex((x) => x.g.date === ev.gameDate);
          if (i < 0) break;
        }
        const [x] = q.splice(i, 1);
        x.slot.paid = true;
        left--;
      }
      if (left > 0) {
        credit[ev.name] = (credit[ev.name] || 0) + left;
        if (ev.gameDate) warnings.push(`${ev.name}: não achei lisa pendente em ${ev.gameDate}; ficou como crédito`);
      }
    }
  }

  const players = [...new Set([...Object.keys(wins), ...Object.keys(losses)])];
  const ranking = players
    .map((name) => ({
      name,
      wins: wins[name] || 0,
      losses: losses[name] || 0,
      saldo: (wins[name] || 0) - (losses[name] || 0),
    }))
    .sort((a, b) => b.saldo - a.saldo || b.wins - a.wins || a.name.localeCompare(b.name, 'pt-BR'));

  const owed = {};
  for (const [name, q] of Object.entries(pending)) if (q.length) owed[name] = q.length;
  const pendingCount = Object.values(owed).reduce((a, b) => a + b, 0);

  return {
    valor,
    games,
    ranking,
    owed,
    cash: payCount * valor,
    pendingCount,
    pendingTotal: pendingCount * valor,
    credit: Object.fromEntries(Object.entries(credit).filter(([, v]) => v > 0)),
    warnings,
  };
}

export function knownPlayers(data) {
  const s = new Set();
  for (const ev of data.events) {
    if (ev.type === 'game') [...ev.win, ...ev.los].forEach((n) => s.add(n));
    else if (ev.type === 'pay') s.add(ev.name);
  }
  return [...s];
}
