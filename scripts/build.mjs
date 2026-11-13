import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { computeState } from '../src/ledger.js';
import { renderHtml } from '../src/render.js';

const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
const template = readFileSync(new URL('../template.html', import.meta.url), 'utf8');
const state = computeState(data);
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/index.html', import.meta.url), renderHtml(template, state));
console.log(`OK: ${state.games.length} jogos, caixa R$ ${state.cash}, pendentes R$ ${state.pendingTotal}`);
for (const w of state.warnings) console.warn('Aviso:', w);
