'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resumir, ganhoDoBarbeiro } = require('../src/stats');

const barbeiros = [
  { id: 1, nome: 'Ana', comissao: 50, ativo: 1 },
  { id: 2, nome: 'Bruno', comissao: 40, ativo: 1 },
  { id: 3, nome: 'Caio', comissao: 45, ativo: 1 },
];

const at = (id, barbeiro_id, valor, pct, extra = {}) => ({
  id, barbeiro_id, barbeiro_nome: barbeiros.find((b) => b.id === barbeiro_id)?.nome ?? 'Antigo',
  servico: 'Corte', valor_centavos: valor, comissao_pct: pct, forma_pagamento: 'Pix', data: '2026-10-14', hora: '10:00',
  ...extra,
});

test('ganho usa a comissão gravada no atendimento e arredonda centavos', () => {
  assert.equal(ganhoDoBarbeiro(at(1, 1, 4000, 50)), 2000);
  assert.equal(ganhoDoBarbeiro(at(1, 1, 3333, 45)), 1500); // 1499,85 → 1500
});

test('resumo sem movimento zera tudo sem dividir por zero', () => {
  const r = resumir([], barbeiros, { inicio: '2026-10-14', fim: '2026-10-14' });
  assert.equal(r.cortes, 0);
  assert.equal(r.ticket_medio, 0);
  assert.equal(r.margem_casa_pct, 0);
  assert.equal(r.por_barbeiro.length, 3);
  assert.deepEqual(r.por_dia, [{ data: '2026-10-14', cortes: 0, faturamento: 0 }]);
});

test('totais, ticket médio, comissões e lucro da casa', () => {
  const r = resumir([
    at(1, 1, 4000, 50),
    at(2, 1, 6500, 50, { servico: 'Corte + Barba', forma_pagamento: 'Dinheiro' }),
    at(3, 2, 3000, 40, { servico: 'Barba' }),
  ], barbeiros);

  assert.equal(r.cortes, 3);
  assert.equal(r.faturamento, 13500);
  assert.equal(r.ticket_medio, 4500);
  assert.equal(r.comissao_barbeiros, 2000 + 3250 + 1200);
  assert.equal(r.lucro_casa, 13500 - 6450);
  assert.equal(r.margem_casa_pct, 52.2);

  const [ana, bruno, caio] = r.por_barbeiro;
  assert.deepEqual(
    { nome: ana.nome, cortes: ana.cortes, faturamento: ana.faturamento, ganho: ana.ganho, ticket: ana.ticket_medio, pct: ana.participacao_pct },
    { nome: 'Ana', cortes: 2, faturamento: 10500, ganho: 5250, ticket: 5250, pct: 77.8 },
  );
  assert.equal(bruno.nome, 'Bruno');
  assert.equal(bruno.ganho, 1200);
  assert.equal(caio.cortes, 0, 'barbeiro sem corte aparece zerado');

  assert.deepEqual(r.por_pagamento.map((p) => [p.forma, p.quantidade, p.total]), [['Pix', 2, 7000], ['Dinheiro', 1, 6500]]);
  assert.equal(r.por_servico[0].servico, 'Corte + Barba');
});

test('barbeiro removido com histórico continua no relatório', () => {
  const r = resumir([at(1, 99, 5000, 30)], barbeiros);
  const removido = r.por_barbeiro.find((b) => b.id === 99);
  assert.equal(removido.ativo, false);
  assert.equal(removido.ganho, 1500);
});

test('por_dia preenche os dias sem movimento do período', () => {
  const r = resumir([at(1, 1, 4000, 50, { data: '2026-10-12' })], barbeiros, { inicio: '2026-10-11', fim: '2026-10-13' });
  assert.deepEqual(r.por_dia.map((d) => [d.data, d.faturamento]), [
    ['2026-10-11', 0], ['2026-10-12', 4000], ['2026-10-13', 0],
  ]);
});
