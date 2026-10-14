'use strict';
const { diasEntre } = require('./datas');

/** Percentual com 1 casa decimal (ex.: 33.3). */
function pct(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : 0;
}

function ticketMedio(faturamento, cortes) {
  return cortes ? Math.round(faturamento / cortes) : 0;
}

/** Quanto o barbeiro ganha num atendimento, usando a comissão gravada no lançamento. */
function ganhoDoBarbeiro(atendimento) {
  return Math.round((atendimento.valor_centavos * atendimento.comissao_pct) / 100);
}

function acumular(mapa, chave, criar) {
  let item = mapa.get(chave);
  if (!item) {
    item = criar();
    mapa.set(chave, item);
  }
  return item;
}

/**
 * Consolida os atendimentos de um período em indicadores do caixa.
 * Todos os valores monetários estão em centavos.
 *
 * @param atendimentos linhas de `atendimentos` (com barbeiro_nome)
 * @param barbeiros    barbeiros que devem aparecer mesmo sem cortes no período
 * @param periodo      { inicio, fim } usado pra preencher os dias sem movimento
 */
function resumir(atendimentos, barbeiros = [], periodo = null) {
  const porBarbeiro = new Map();
  const porDia = new Map();
  const porPagamento = new Map();
  const porServico = new Map();
  let cortes = 0;
  let faturamento = 0;
  let comissoes = 0;

  for (const b of barbeiros) {
    porBarbeiro.set(b.id, {
      id: b.id, nome: b.nome, comissao_pct: b.comissao, ativo: Boolean(b.ativo),
      cortes: 0, faturamento: 0, ganho: 0,
    });
  }
  if (periodo) {
    for (const data of diasEntre(periodo.inicio, periodo.fim)) {
      porDia.set(data, { data, cortes: 0, faturamento: 0 });
    }
  }

  for (const a of atendimentos) {
    const valor = a.valor_centavos;
    const ganho = ganhoDoBarbeiro(a);
    cortes += 1;
    faturamento += valor;
    comissoes += ganho;

    const b = acumular(porBarbeiro, a.barbeiro_id, () => ({
      id: a.barbeiro_id, nome: a.barbeiro_nome, comissao_pct: a.comissao_pct, ativo: false,
      cortes: 0, faturamento: 0, ganho: 0,
    }));
    b.cortes += 1;
    b.faturamento += valor;
    b.ganho += ganho;

    const d = acumular(porDia, a.data, () => ({ data: a.data, cortes: 0, faturamento: 0 }));
    d.cortes += 1;
    d.faturamento += valor;

    const p = acumular(porPagamento, a.forma_pagamento, () => ({ forma: a.forma_pagamento, quantidade: 0, total: 0 }));
    p.quantidade += 1;
    p.total += valor;

    const s = acumular(porServico, a.servico, () => ({ servico: a.servico, quantidade: 0, total: 0 }));
    s.quantidade += 1;
    s.total += valor;
  }

  const lucroCasa = faturamento - comissoes;

  return {
    cortes,
    faturamento,
    ticket_medio: ticketMedio(faturamento, cortes),
    comissao_barbeiros: comissoes,
    lucro_casa: lucroCasa,
    margem_casa_pct: pct(lucroCasa, faturamento),
    por_barbeiro: [...porBarbeiro.values()]
      .map((b) => ({
        ...b,
        ticket_medio: ticketMedio(b.faturamento, b.cortes),
        participacao_pct: pct(b.faturamento, faturamento),
      }))
      .sort((x, y) => y.faturamento - x.faturamento || x.nome.localeCompare(y.nome, 'pt-BR')),
    por_dia: [...porDia.values()].sort((x, y) => x.data.localeCompare(y.data)),
    por_pagamento: [...porPagamento.values()]
      .map((p) => ({ ...p, participacao_pct: pct(p.total, faturamento) }))
      .sort((x, y) => y.total - x.total),
    por_servico: [...porServico.values()]
      .map((s) => ({ ...s, participacao_pct: pct(s.total, faturamento) }))
      .sort((x, y) => y.total - x.total),
  };
}

module.exports = { resumir, ganhoDoBarbeiro, pct };
