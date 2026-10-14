'use strict';

if (exigirSessao('barbeiro')) iniciar();

async function iniciar() {
  const estado = {
    eu: null,
    config: null,
    servico: null,
    pagamento: null,
    periodo: 'hoje',
  };

  const form = document.getElementById('form-lancar');
  const elServicos = document.getElementById('servicos');
  const elPagamentos = document.getElementById('pagamentos');
  const campoOutro = document.getElementById('campo-outro');
  const previaGanho = document.getElementById('previa-ganho');

  document.getElementById('sair').addEventListener('click', sair);

  try {
    [estado.eu, estado.config] = await Promise.all([api('GET', '/api/eu'), api('GET', '/api/config')]);
  } catch (e) {
    avisar(e.message, 'falha');
    return;
  }

  document.getElementById('ola').textContent = `Olá, ${estado.eu.nome.split(' ')[0]}!`;
  document.getElementById('comissao-info').textContent = `Sua comissão: ${porcento(estado.eu.comissao)} de cada atendimento`;

  // ----- formulário de lançamento -----

  elServicos.innerHTML = estado.config.servicos.map((s) => `
    <button type="button" class="chip" aria-pressed="false" data-valor="${esc(s.nome)}" data-preco="${s.valor_centavos}">
      ${esc(s.nome)}<small>${brl(s.valor_centavos)}</small>
    </button>`).join('')
    + '<button type="button" class="chip" aria-pressed="false" data-valor="__outro">Outro<small>digitar</small></button>';

  elPagamentos.innerHTML = estado.config.formas_pagamento
    .map((f) => `<button type="button" class="chip" aria-pressed="false" data-valor="${esc(f)}">${esc(f)}</button>`)
    .join('');

  function atualizarPrevia() {
    const c = paraCentavos(form.elements.valor.value);
    previaGanho.innerHTML = c > 0
      ? `Você ganha <strong class="ganho">${brl(Math.round((c * estado.eu.comissao) / 100))}</strong> nesse atendimento.`
      : '&nbsp;';
  }

  grupoDeChips(elServicos, (valor, chip) => {
    estado.servico = valor;
    campoOutro.hidden = valor !== '__outro';
    if (valor === '__outro') {
      form.elements.servico_outro.focus();
    } else {
      form.elements.valor.value = centavosParaCampo(Number(chip.dataset.preco));
    }
    atualizarPrevia();
  });

  grupoDeChips(elPagamentos, (valor) => { estado.pagamento = valor; });
  form.elements.valor.addEventListener('input', atualizarPrevia);

  function limparFormulario() {
    estado.servico = null;
    estado.pagamento = null;
    form.reset();
    campoOutro.hidden = true;
    form.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    atualizarPrevia();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const servico = estado.servico === '__outro' ? form.elements.servico_outro.value.trim() : estado.servico;
    const valorCentavos = paraCentavos(form.elements.valor.value);
    if (!servico) return avisar('Escolha o serviço.', 'falha');
    if (!(valorCentavos > 0)) return avisar('Informe um valor válido.', 'falha');
    if (!estado.pagamento) return avisar('Escolha a forma de pagamento.', 'falha');

    const botao = form.querySelector('button[type="submit"], button:not([type])');
    botao.disabled = true;
    try {
      await api('POST', '/api/eu/atendimentos', {
        servico, valor_centavos: valorCentavos, forma_pagamento: estado.pagamento,
      });
      avisar(`${servico} de ${brl(valorCentavos)} lançado!`);
      limparFormulario();
      await carregarResumo();
    } catch (e) {
      avisar(e.message, 'falha');
    } finally {
      botao.disabled = false;
    }
  });

  // ----- resumo e lista -----

  grupoDeChips(document.getElementById('periodos'), (valor) => {
    estado.periodo = valor;
    carregarResumo();
  });

  async function carregarResumo() {
    try {
      await buscarResumo();
      marcarAoVivo(true);
    } catch (e) {
      avisar(e.message, 'falha');
    }
  }

  async function buscarResumo() {
    const p = periodoRapido(estado.periodo, estado.config.hoje);
    const dados = await api('GET', `/api/eu/resumo?inicio=${p.inicio}&fim=${p.fim}`);
    if (dados.hoje !== estado.config.hoje) {
      // Virou o dia com a tela aberta: refaz o período ("Hoje" passa a ser o novo dia).
      estado.config.hoje = dados.hoje;
      return buscarResumo();
    }
    const r = dados.resumo;

    document.getElementById('periodo-texto').textContent = descreverPeriodo(dados.periodo);
    document.getElementById('kpis').innerHTML = [
      kpi({ rotulo: 'Atendimentos', valor: String(r.cortes) }),
      kpi({ rotulo: 'Faturado', valor: brl(r.faturamento) }),
      kpi({ rotulo: 'Ticket médio', valor: brl(r.ticket_medio) }),
      kpi({ rotulo: 'Meu ganho', valor: brl(r.comissao_barbeiros), extra: `${porcento(estado.eu.comissao)} de comissão`, destaque: true }),
    ].join('');

    const variosDias = dados.periodo.inicio !== dados.periodo.fim;
    document.getElementById('qtd-lancamentos').textContent = `${dados.atendimentos.length} no período`;
    document.getElementById('lista').innerHTML = dados.atendimentos.length
      ? dados.atendimentos.map((a) => `
        <li>
          <div class="info">
            <strong>${esc(a.servico)}</strong>
            <span>${variosDias ? `${dataCurta(a.data)} · ` : ''}${esc(a.hora)} · ${esc(a.forma_pagamento)}</span>
          </div>
          <div class="valores">
            <strong>${brl(a.valor_centavos)}</strong>
            <span class="ganho" style="font-size:.82rem">+${brl(a.ganho_centavos)}</span>
          </div>
          ${a.data === dados.hoje
            ? `<button class="btn perigo pequeno" data-excluir="${a.id}" aria-label="Excluir ${esc(a.servico)} das ${esc(a.hora)}">✕</button>`
            : ''}
        </li>`).join('')
      : '<li class="vazio" style="display:block">Nenhum atendimento lançado nesse período.</li>';
  }

  document.getElementById('lista').addEventListener('click', async (ev) => {
    const botao = ev.target.closest('[data-excluir]');
    if (!botao) return;
    if (!confirm('Excluir esse lançamento?')) return;
    try {
      await api('DELETE', `/api/eu/atendimentos/${botao.dataset.excluir}`);
      avisar('Lançamento excluído.');
      await carregarResumo();
    } catch (e) {
      avisar(e.message, 'falha');
    }
  });

  await carregarResumo();
  atualizarSozinho(buscarResumo);
}
