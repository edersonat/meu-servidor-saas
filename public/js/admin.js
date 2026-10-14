'use strict';

if (exigirSessao('admin')) iniciar();

async function iniciar() {
  const estado = {
    config: null,
    aba: 'visao',
    periodo: { chave: 'hoje', inicio: null, fim: null },
    barbeiros: [],
    editando: null,
  };
  const $ = (id) => document.getElementById(id);

  $('sair').addEventListener('click', sair);

  try {
    estado.config = await api('GET', '/api/config');
  } catch (e) {
    avisar(e.message, 'falha');
    return;
  }
  $('nome-barbearia').textContent = estado.config.nome_barbearia;
  Object.assign(estado.periodo, periodoRapido('hoje', estado.config.hoje));

  // ----- abas -----

  document.querySelectorAll('[data-aba]').forEach((botao) => {
    botao.addEventListener('click', () => {
      estado.aba = botao.dataset.aba;
      document.querySelectorAll('[data-aba]').forEach((b) => b.setAttribute('aria-selected', String(b === botao)));
      for (const nome of ['visao', 'atendimentos', 'barbeiros']) $(`aba-${nome}`).hidden = nome !== estado.aba;
      $('filtro-periodo').hidden = estado.aba === 'barbeiros';
      atualizar();
    });
  });

  // ----- período -----

  grupoDeChips($('periodos'), (chave) => {
    estado.periodo.chave = chave;
    $('datas-custom').hidden = chave !== 'custom';
    if (chave === 'custom') {
      $('data-inicio').value = estado.periodo.inicio;
      $('data-fim').value = estado.periodo.fim;
      $('data-inicio').max = estado.config.hoje;
      $('data-fim').max = estado.config.hoje;
      return;
    }
    Object.assign(estado.periodo, periodoRapido(chave, estado.config.hoje));
    atualizar();
  });

  for (const campo of ['data-inicio', 'data-fim']) {
    $(campo).addEventListener('change', () => {
      const inicio = $('data-inicio').value;
      const fim = $('data-fim').value;
      if (!inicio || !fim) return;
      if (inicio > fim) return avisar('A data inicial precisa ser antes da final.', 'falha');
      Object.assign(estado.periodo, { inicio, fim });
      atualizar();
    });
  }

  const consultaPeriodo = () => `inicio=${estado.periodo.inicio}&fim=${estado.periodo.fim}`;

  // ----- visão geral -----

  async function carregarVisao() {
    const { resumo: r, periodo } = await api('GET', `/api/admin/resumo?${consultaPeriodo()}`);
    $('periodo-texto').textContent = descreverPeriodo(periodo);

    $('kpis').innerHTML = [
      kpi({ rotulo: 'Faturamento', valor: brl(r.faturamento), destaque: true }),
      kpi({ rotulo: 'Atendimentos', valor: String(r.cortes) }),
      kpi({ rotulo: 'Ticket médio', valor: brl(r.ticket_medio) }),
      kpi({ rotulo: 'Comissões', valor: brl(r.comissao_barbeiros), extra: `${porcento(100 - r.margem_casa_pct)} pros barbeiros` }),
      kpi({ rotulo: 'Fica pra casa', valor: brl(r.lucro_casa), extra: `${porcento(r.margem_casa_pct)} do faturado` }),
    ].join('');

    $('tabela-barbeiros').innerHTML = r.por_barbeiro.length
      ? r.por_barbeiro.map((b) => `
        <tr>
          <td>${esc(b.nome)} ${b.ativo ? '' : '<span class="tag">removido</span>'}</td>
          <td class="num">${porcento(b.comissao_pct)}</td>
          <td class="num">${b.cortes}</td>
          <td class="num">${brl(b.faturamento)}</td>
          <td class="num">${brl(b.ticket_medio)}</td>
          <td class="num ganho">${brl(b.ganho)}</td>
          <td class="num">${brl(b.faturamento - b.ganho)}</td>
          <td class="num">${porcento(b.participacao_pct)}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="vazio">Nenhum barbeiro cadastrado. Vá na aba Barbeiros.</td></tr>';

    const variosDias = periodo.inicio !== periodo.fim;
    $('card-grafico').hidden = !variosDias;
    if (variosDias) {
      $('grafico').innerHTML = graficoColunas(
        r.por_dia.map((d) => ({ rotulo: dataCurta(d.data), valor: d.faturamento })),
        brl,
      );
    }

    $('pagamentos').innerHTML = barras(r.por_pagamento.map((p) => ({
      rotulo: `${p.forma} (${p.quantidade})`, valor: brl(p.total), pct: p.participacao_pct,
    })));
    $('servicos').innerHTML = barras(r.por_servico.map((s) => ({
      rotulo: `${s.servico} (${s.quantidade})`, valor: brl(s.total), pct: s.participacao_pct,
    })));
  }

  // ----- atendimentos -----

  const formLancar = $('form-lancar');
  formLancar.elements.forma_pagamento.innerHTML = estado.config.formas_pagamento
    .map((f) => `<option>${esc(f)}</option>`).join('');
  $('lista-servicos').innerHTML = estado.config.servicos
    .map((s) => `<option value="${esc(s.nome)}"></option>`).join('');
  formLancar.elements.servico.addEventListener('change', () => {
    const s = estado.config.servicos.find((x) => x.nome === formLancar.elements.servico.value);
    if (s && !formLancar.elements.valor.value) formLancar.elements.valor.value = centavosParaCampo(s.valor_centavos);
  });

  formLancar.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const valorCentavos = paraCentavos(formLancar.elements.valor.value);
    if (!(valorCentavos > 0)) return avisar('Informe um valor válido.', 'falha');
    try {
      await api('POST', '/api/admin/atendimentos', {
        barbeiro_id: Number(formLancar.elements.barbeiro_id.value),
        servico: formLancar.elements.servico.value,
        valor_centavos: valorCentavos,
        forma_pagamento: formLancar.elements.forma_pagamento.value,
      });
      avisar('Atendimento lançado!');
      formLancar.elements.servico.value = '';
      formLancar.elements.valor.value = '';
      await carregarAtendimentos();
    } catch (e) {
      avisar(e.message, 'falha');
    }
  });

  function preencherSelectsDeBarbeiro() {
    const opcoes = estado.barbeiros.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join('');
    formLancar.elements.barbeiro_id.innerHTML = '<option value="">Escolha…</option>' + opcoes;
    const filtro = $('filtro-barbeiro');
    const atual = filtro.value;
    filtro.innerHTML = '<option value="">Todos os barbeiros</option>' + opcoes;
    filtro.value = estado.barbeiros.some((b) => String(b.id) === atual) ? atual : '';
  }

  $('filtro-barbeiro').addEventListener('change', () => carregarAtendimentos().catch((e) => avisar(e.message, 'falha')));

  async function carregarAtendimentos() {
    const filtro = $('filtro-barbeiro').value;
    const { atendimentos, periodo } = await api(
      'GET', `/api/admin/atendimentos?${consultaPeriodo()}${filtro ? `&barbeiro_id=${filtro}` : ''}`,
    );
    $('periodo-texto').textContent = descreverPeriodo(periodo);
    $('tabela-atendimentos').innerHTML = atendimentos.length
      ? atendimentos.map((a) => `
        <tr>
          <td>${dataCurta(a.data)}</td>
          <td>${esc(a.hora)}</td>
          <td>${esc(a.barbeiro_nome)}</td>
          <td>${esc(a.servico)}</td>
          <td><span class="tag">${esc(a.forma_pagamento)}</span></td>
          <td class="num">${brl(a.valor_centavos)}</td>
          <td class="num mudo">${brl(a.ganho_centavos)} (${porcento(a.comissao_pct)})</td>
          <td class="num"><button class="btn perigo pequeno" data-excluir-atendimento="${a.id}">Excluir</button></td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="vazio">Nenhum lançamento nesse período.</td></tr>';
  }

  $('tabela-atendimentos').addEventListener('click', async (ev) => {
    const botao = ev.target.closest('[data-excluir-atendimento]');
    if (!botao || !confirm('Excluir esse lançamento? Isso altera o caixa.')) return;
    try {
      await api('DELETE', `/api/admin/atendimentos/${botao.dataset.excluirAtendimento}`);
      avisar('Lançamento excluído.');
      await carregarAtendimentos();
    } catch (e) {
      avisar(e.message, 'falha');
    }
  });

  // ----- barbeiros -----

  async function carregarBarbeiros() {
    estado.barbeiros = await api('GET', '/api/admin/barbeiros');
    preencherSelectsDeBarbeiro();
    $('qtd-barbeiros').textContent = `${estado.barbeiros.length} ${estado.barbeiros.length === 1 ? 'barbeiro' : 'barbeiros'}`;
    $('tabela-equipe').innerHTML = estado.barbeiros.length
      ? estado.barbeiros.map((b) => `
        <tr>
          <td>${esc(b.nome)}</td>
          <td class="num">${porcento(b.comissao)}</td>
          <td class="mudo">${dataLonga(b.criado_em.slice(0, 10))}</td>
          <td class="num">
            <button class="btn pequeno" data-editar="${b.id}">Editar</button>
            <button class="btn perigo pequeno" data-excluir-barbeiro="${b.id}">Excluir</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="vazio">Nenhum barbeiro ainda. Cadastre o primeiro acima.</td></tr>';
  }

  const formBarbeiro = $('form-barbeiro');
  formBarbeiro.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const novo = await api('POST', '/api/admin/barbeiros', {
        nome: formBarbeiro.elements.nome.value,
        comissao: Number(formBarbeiro.elements.comissao.value),
        pin: formBarbeiro.elements.pin.value,
      });
      avisar(`${novo.nome} cadastrado! Já pode entrar com o PIN.`);
      formBarbeiro.reset();
      await carregarBarbeiros();
    } catch (e) {
      avisar(e.message, 'falha');
    }
  });

  const dialogo = $('dialogo-editar');
  const formEditar = $('form-editar');

  $('tabela-equipe').addEventListener('click', async (ev) => {
    const editar = ev.target.closest('[data-editar]');
    const excluir = ev.target.closest('[data-excluir-barbeiro]');

    if (editar) {
      estado.editando = estado.barbeiros.find((b) => String(b.id) === editar.dataset.editar);
      formEditar.elements.nome.value = estado.editando.nome;
      formEditar.elements.comissao.value = estado.editando.comissao;
      formEditar.elements.pin.value = '';
      dialogo.showModal();
    }

    if (excluir) {
      const b = estado.barbeiros.find((x) => String(x.id) === excluir.dataset.excluirBarbeiro);
      if (!confirm(`Excluir ${b.nome}? Ele perde o acesso ao sistema.`)) return;
      try {
        await api('DELETE', `/api/admin/barbeiros/${b.id}`);
        avisar(`${b.nome} foi removido da equipe.`);
        await carregarBarbeiros();
      } catch (e) {
        avisar(e.message, 'falha');
      }
    }
  });

  formEditar.addEventListener('submit', async (ev) => {
    if (ev.submitter?.value !== 'salvar') return;
    ev.preventDefault();
    const corpo = {
      nome: formEditar.elements.nome.value,
      comissao: Number(formEditar.elements.comissao.value),
    };
    if (formEditar.elements.pin.value) corpo.pin = formEditar.elements.pin.value;
    try {
      await api('PATCH', `/api/admin/barbeiros/${estado.editando.id}`, corpo);
      dialogo.close();
      avisar('Dados atualizados.');
      await carregarBarbeiros();
    } catch (e) {
      avisar(e.message, 'falha');
    }
  });

  // ----- carregamento -----

  async function atualizar() {
    try {
      if (estado.aba === 'visao') await carregarVisao();
      if (estado.aba === 'atendimentos') await carregarAtendimentos();
      if (estado.aba === 'barbeiros') await carregarBarbeiros();
    } catch (e) {
      avisar(e.message, 'falha');
    }
  }

  await carregarBarbeiros().catch((e) => avisar(e.message, 'falha'));
  await atualizar();
}
