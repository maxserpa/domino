import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { computeState, knownPlayers } from '../src/ledger.js';
import { parseMessage } from '../src/parser.js';
import { renderHtml } from '../src/render.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
// Os testes usam uma cópia fixa dos dados (fixture), para não quebrarem quando o bot gravar lisas novas.
const data = JSON.parse(read('./fixture.json'));
const st = computeState(data);

// 1) Estado atual bate com o que foi conferido na mão
assert.equal(st.games.length, 29);
assert.equal(st.cash, 510);
assert.equal(st.pendingTotal, 70);
assert.deepEqual(st.owed, { Augusto: 3, Ricardo: 1, Reinaldo: 1, Luizinho: 1, Hugo: 1 });
assert.deepEqual(st.owedDetail.Augusto, ['2026-04-28', '2026-05-25', '2026-10-06']);
assert.deepEqual(st.owedDetail.Luizinho, ['2026-11-02']);
const max = st.ranking.find((p) => p.name === 'Max');
assert.deepEqual([max.wins, max.losses, max.saldo], [3, 9, -6]);

// 2) HTML gerado é idêntico ao aprovado
const norm = (s) => s.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
assert.equal(norm(renderHtml(read('../template.html'), st)), norm(read('./expected.html')));

// 3) Parser
const ctx = { date: '2026-11-06', valor: 10, aliases: data.aliases, known: knownPlayers(data) };
let r = parseMessage('WIN: Nildo e Romeu\nLOS: Hogo e Luizinho', ctx);
assert.deepEqual(r.events, [{ type: 'game', date: '2026-11-06', win: ['Nildo', 'Romeu'], los: ['Hugo', 'Luizinho'] }]);
assert.deepEqual(r.errors, []);

r = parseMessage('LOS: Ricardo e Luizinho \nWIN: Romeu e Nildo', ctx); // ordem invertida
assert.deepEqual(r.events[0].win, ['Romeu', 'Nildo']);

r = parseMessage('Win: Hugo e Luizinho\nLoser: Nildo e romeu', ctx);
assert.equal(r.events.length, 1);

r = parseMessage('Nildo PAGO;\nLuizinho Pago\nDamilton pagou 20 reais', ctx);
assert.deepEqual(r.events.map((e) => [e.name, e.count]), [['Nildo', 1], ['Luizinho', 1], ['Damilton', 2]]);

r = parseMessage('Max pago 25/05', ctx);
assert.deepEqual(r.events, [{ type: 'pay', date: '2026-11-06', name: 'Max', count: 1, gameDate: '2026-05-25' }]);

r = parseMessage('[2/2/26, 10:33:30 PM] Você: Romeu pago', ctx);
assert.equal(r.events[0].name, 'Romeu');

r = parseMessage('WIN: Max e Fulano\nLOS: Rubens e Damilton', ctx);
assert.deepEqual(r.newNames, ['Fulano']);

r = parseMessage('WIN: Max e Rubens e Nildo\nLOS: Ricardo e Romeu', ctx);
assert.equal(r.events.length, 0);
assert.equal(r.errors.length, 1);

r = parseMessage('bom dia pessoal', ctx);
assert.equal(r.events.length, 0);

// 3b) Data escrita no texto
const ctxD = { ...ctx, date: '2026-11-18' };
r = parseMessage('dia 16/11\nLoser: Luizinho e Ricardo\nWin: Gonzaga e Osnildo', ctxD);
assert.deepEqual(r.events, [{ type: 'game', date: '2026-11-16', win: ['Gonzaga', 'Osnildo'], los: ['Luizinho', 'Ricardo'] }]);
assert.equal(r.explicitDate, true);
assert.deepEqual(r.errors, []);

r = parseMessage('WIN: Max e Hugo\nLOS: Nildo e Romeu\nData: 10/11/2026', ctxD); // data no fim, com "Data:" e ano
assert.equal(r.events[0].date, '2026-11-10');

r = parseMessage('ontem\nNildo pago', ctxD);
assert.deepEqual(r.events.map((e) => [e.name, e.date]), [['Nildo', '2026-11-17']]);

r = parseMessage('anteontem\nWIN: Max e Hugo\nLOS: Nildo e Romeu', ctxD);
assert.equal(r.events[0].date, '2026-11-16');

r = parseMessage('16/11\nWIN: Max e Hugo\nLOS: Nildo e Romeu', ctxD); // só a data numa linha
assert.equal(r.events[0].date, '2026-11-16');

r = parseMessage('dia 16/11 - WIN: Max e Hugo\nLOS: Nildo e Romeu', ctxD); // data e WIN na mesma linha
assert.deepEqual([r.events[0].date, r.events[0].win], ['2026-11-16', ['Max', 'Hugo']]);

r = parseMessage('WIN: Max e Hugo\nLOS: Nildo e Romeu', ctxD); // sem data escrita: vale a da mensagem
assert.deepEqual([r.events[0].date, r.explicitDate], ['2026-11-18', false]);

r = parseMessage('dia 28/12\nWIN: Max e Hugo\nLOS: Nildo e Romeu', { ...ctxD, date: '2027-01-05' }); // virada de ano
assert.equal(r.events[0].date, '2026-12-28');

r = parseMessage('dia 31/02\nWIN: Max e Hugo\nLOS: Nildo e Romeu', ctxD);
assert.equal(r.errors.length, 1); // data que não existe

r = parseMessage('dia 25/11\nWIN: Max e Hugo\nLOS: Nildo e Romeu', ctxD);
assert.match(r.errors[0], /futuro/);

r = parseMessage('dia 16/11\nMax pago 25/05', ctxD); // data da mensagem x data da lisa paga
assert.deepEqual(r.events, [{ type: 'pay', date: '2026-11-16', name: 'Max', count: 1, gameDate: '2026-05-25' }]);

// 4) Ledger: pagamento antecipado vira crédito; pagamento direcionado quita a lisa certa
const mini = {
  valor: 10,
  events: [
    { type: 'pay', name: 'A', count: 1 },
    { type: 'game', date: '2026-01-01', win: ['C', 'D'], los: ['A', 'B'] },
    { type: 'game', date: '2026-01-02', win: ['C', 'D'], los: ['A', 'B'] },
    { type: 'pay', name: 'B', count: 1, gameDate: '2026-01-02' },
  ],
};
const s2 = computeState(mini);
assert.deepEqual(s2.owed, { A: 1, B: 1 });
assert.equal(s2.games[0].los[0].paid, true);   // A: crédito abateu a 1ª
assert.equal(s2.games[1].los[1].paid, true);   // B: quitou a de 02/01
assert.equal(s2.games[0].los[1].paid, false);  // B continua devendo a de 01/01
assert.equal(s2.cash, 20);

// 5) O data.json real continua válido (formato e cálculo), sem fixar números
const live = JSON.parse(read('../data.json'));
const ls = computeState(live);
assert.ok(ls.games.length >= 29);
for (const e of live.events) {
  assert.ok(['game', 'pay'].includes(e.type), `tipo inválido: ${e.type}`);
  if (e.type === 'game') assert.ok(e.win.length === 2 && e.los.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  if (e.type === 'pay') assert.ok(e.name && e.count >= 1);
}

console.log('Todos os testes passaram.');
