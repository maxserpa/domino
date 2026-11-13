import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { computeState, knownPlayers } from '../src/ledger.js';
import { parseMessage } from '../src/parser.js';
import { renderHtml } from '../src/render.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const data = JSON.parse(read('../data.json'));
const st = computeState(data);

// 1) Estado atual bate com o que foi conferido na mão
assert.equal(st.games.length, 29);
assert.equal(st.cash, 510);
assert.equal(st.pendingTotal, 70);
assert.deepEqual(st.owed, { Augusto: 3, Ricardo: 1, Reinaldo: 1, Luizinho: 1, Hugo: 1 });
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

console.log('Todos os testes passaram.');
