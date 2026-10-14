'use strict';
const { DatabaseSync } = require('node:sqlite');

const ESQUEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS barbeiros (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nome       TEXT    NOT NULL,
    comissao   REAL    NOT NULL,            -- % do valor do corte que fica com o barbeiro
    pin_hash   TEXT    NOT NULL,
    ativo      INTEGER NOT NULL DEFAULT 1,  -- 0 = removido (mantém o histórico do caixa)
    criado_em  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS atendimentos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    barbeiro_id     INTEGER NOT NULL REFERENCES barbeiros(id),
    servico         TEXT    NOT NULL,
    valor_centavos  INTEGER NOT NULL CHECK (valor_centavos > 0),
    comissao_pct    REAL    NOT NULL,       -- comissão do barbeiro no momento do lançamento
    forma_pagamento TEXT    NOT NULL,
    data            TEXT    NOT NULL,       -- YYYY-MM-DD no fuso da barbearia
    hora            TEXT    NOT NULL,       -- HH:MM
    criado_em       TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_atendimentos_data ON atendimentos (data);
  CREATE INDEX IF NOT EXISTS idx_atendimentos_barbeiro_data ON atendimentos (barbeiro_id, data);
`;

const CAMPOS_BARBEIRO = 'id, nome, comissao, ativo, criado_em';
const SELECT_ATENDIMENTOS = `
  SELECT a.id, a.barbeiro_id, b.nome AS barbeiro_nome, a.servico, a.valor_centavos,
         a.comissao_pct, a.forma_pagamento, a.data, a.hora
    FROM atendimentos a
    JOIN barbeiros b ON b.id = a.barbeiro_id`;

function abrirBanco(arquivo) {
  const db = new DatabaseSync(arquivo);
  if (arquivo !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(ESQUEMA);

  const st = {
    barbeirosAtivos: db.prepare(`SELECT ${CAMPOS_BARBEIRO} FROM barbeiros WHERE ativo = 1 ORDER BY nome COLLATE NOCASE`),
    todosBarbeiros: db.prepare(`SELECT ${CAMPOS_BARBEIRO} FROM barbeiros ORDER BY nome COLLATE NOCASE`),
    buscarBarbeiro: db.prepare('SELECT * FROM barbeiros WHERE id = ?'),
    nomeEmUso: db.prepare('SELECT id FROM barbeiros WHERE ativo = 1 AND lower(nome) = lower(?) AND id <> ?'),
    inserirBarbeiro: db.prepare('INSERT INTO barbeiros (nome, comissao, pin_hash, ativo, criado_em) VALUES (?, ?, ?, 1, ?)'),
    atualizarBarbeiro: db.prepare('UPDATE barbeiros SET nome = ?, comissao = ?, pin_hash = ? WHERE id = ?'),
    contarAtendimentos: db.prepare('SELECT COUNT(*) AS n FROM atendimentos WHERE barbeiro_id = ?'),
    apagarBarbeiro: db.prepare('DELETE FROM barbeiros WHERE id = ?'),
    desativarBarbeiro: db.prepare('UPDATE barbeiros SET ativo = 0 WHERE id = ?'),

    inserirAtendimento: db.prepare(`
      INSERT INTO atendimentos (barbeiro_id, servico, valor_centavos, comissao_pct, forma_pagamento, data, hora, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    buscarAtendimento: db.prepare(`${SELECT_ATENDIMENTOS} WHERE a.id = ?`),
    apagarAtendimento: db.prepare('DELETE FROM atendimentos WHERE id = ?'),
    atendimentosPeriodo: db.prepare(`${SELECT_ATENDIMENTOS}
      WHERE a.data BETWEEN ? AND ? ORDER BY a.data DESC, a.hora DESC, a.id DESC`),
    atendimentosPeriodoBarbeiro: db.prepare(`${SELECT_ATENDIMENTOS}
      WHERE a.data BETWEEN ? AND ? AND a.barbeiro_id = ? ORDER BY a.data DESC, a.hora DESC, a.id DESC`),
  };

  return {
    listarBarbeiros({ incluirRemovidos = false } = {}) {
      return (incluirRemovidos ? st.todosBarbeiros : st.barbeirosAtivos).all();
    },

    buscarBarbeiro(id) {
      return st.buscarBarbeiro.get(id);
    },

    nomeEmUso(nome, ignorarId = 0) {
      return Boolean(st.nomeEmUso.get(nome, ignorarId));
    },

    criarBarbeiro({ nome, comissao, pinHash }) {
      const r = st.inserirBarbeiro.run(nome, comissao, pinHash, new Date().toISOString());
      return st.buscarBarbeiro.get(Number(r.lastInsertRowid));
    },

    atualizarBarbeiro(id, { nome, comissao, pinHash }) {
      const atual = st.buscarBarbeiro.get(id);
      if (!atual) return null;
      st.atualizarBarbeiro.run(nome ?? atual.nome, comissao ?? atual.comissao, pinHash ?? atual.pin_hash, id);
      return st.buscarBarbeiro.get(id);
    },

    /**
     * Sem lançamentos: apaga de vez. Com lançamentos: só desativa,
     * pra não sumir dinheiro dos relatórios antigos.
     */
    removerBarbeiro(id) {
      const { n } = st.contarAtendimentos.get(id);
      if (n === 0) {
        st.apagarBarbeiro.run(id);
        return 'apagado';
      }
      st.desativarBarbeiro.run(id);
      return 'desativado';
    },

    criarAtendimento({ barbeiroId, servico, valorCentavos, comissaoPct, formaPagamento, data, hora }) {
      const r = st.inserirAtendimento.run(
        barbeiroId, servico, valorCentavos, comissaoPct, formaPagamento, data, hora, new Date().toISOString(),
      );
      return st.buscarAtendimento.get(Number(r.lastInsertRowid));
    },

    buscarAtendimento(id) {
      return st.buscarAtendimento.get(id);
    },

    apagarAtendimento(id) {
      return st.apagarAtendimento.run(id).changes > 0;
    },

    listarAtendimentos({ inicio, fim, barbeiroId }) {
      return barbeiroId
        ? st.atendimentosPeriodoBarbeiro.all(inicio, fim, barbeiroId)
        : st.atendimentosPeriodo.all(inicio, fim);
    },

    fechar() {
      db.close();
    },
  };
}

module.exports = { abrirBanco };
