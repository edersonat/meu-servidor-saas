'use strict';
/* Funções compartilhadas entre as telas. */

const Sessao = (() => {
  const memoria = {};
  const ler = (k) => { try { return localStorage.getItem(k); } catch { return memoria[k] ?? null; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch { memoria[k] = v; } };
  const apagar = (k) => { try { localStorage.removeItem(k); } catch { delete memoria[k]; } };
  return {
    get token() { return ler('caixa.token'); },
    get papel() { return ler('caixa.papel'); },
    salvar(token, papel) { gravar('caixa.token', token); gravar('caixa.papel', papel); },
    limpar() { apagar('caixa.token'); apagar('caixa.papel'); },
  };
})();

function sair() {
  Sessao.limpar();
  location.href = '/';
}

/** Exige login com o papel certo; senão volta pra tela de entrada. */
function exigirSessao(papel) {
  if (!Sessao.token || Sessao.papel !== papel) {
    location.replace('/');
    return false;
  }
  return true;
}

async function api(metodo, url, corpo) {
  const cabecalhos = { 'Content-Type': 'application/json' };
  if (Sessao.token) cabecalhos.Authorization = `Bearer ${Sessao.token}`;
  const res = await fetch(url, {
    method: metodo,
    headers: cabecalhos,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const dados = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    sair();
    throw new Error(dados.erro || 'Sessão expirada.');
  }
  if (!res.ok) throw new Error(dados.erro || 'Algo deu errado. Tente de novo.');
  return dados;
}

// ---------- formatação ----------

const formatoBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (centavos) => formatoBRL.format((centavos || 0) / 100);
const porcento = (n) => `${Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** "45", "45,5", "1.234,50" ou "45.50" → centavos. */
function paraCentavos(texto) {
  let s = String(texto ?? '').replace(/[R$\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return s && Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const centavosParaCampo = (c) => (c / 100).toFixed(2).replace('.', ',');

function dataCurta(iso) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function dataLonga(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function somarDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Períodos rápidos, calculados a partir do "hoje" do servidor (fuso da barbearia). */
function periodoRapido(chave, hoje) {
  switch (chave) {
    case 'ontem': { const o = somarDias(hoje, -1); return { inicio: o, fim: o }; }
    case '7d': return { inicio: somarDias(hoje, -6), fim: hoje };
    case 'mes': return { inicio: `${hoje.slice(0, 8)}01`, fim: hoje };
    case '30d': return { inicio: somarDias(hoje, -29), fim: hoje };
    default: return { inicio: hoje, fim: hoje };
  }
}

function descreverPeriodo({ inicio, fim }) {
  return inicio === fim ? dataLonga(inicio) : `${dataLonga(inicio)} a ${dataLonga(fim)}`;
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---------- atualização automática ----------

const INTERVALO_ATUALIZACAO_MS = 30 * 1000;

/** Mostra no topo se a tela está em dia com o servidor. */
function marcarAoVivo(ok) {
  const el = document.getElementById('ao-vivo');
  if (!el) return;
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  el.classList.toggle('offline', !ok);
  el.querySelector('.texto').textContent = ok ? `Atualizado ${hora}` : 'Sem conexão';
  el.title = ok
    ? 'Os números se atualizam sozinhos a cada 30 segundos.'
    : 'Não deu pra falar com o servidor. Tentando de novo em 30 segundos.';
}

/**
 * Roda `recarregar` a cada 30 s enquanto a tela está visível e logo que o
 * usuário volta pra ela (ex.: desbloqueou o celular). Falhas não viram aviso
 * na tela, só o indicador muda pra "Sem conexão".
 */
function atualizarSozinho(recarregar) {
  let rodando = false;
  async function rodar() {
    if (rodando || document.visibilityState !== 'visible') return;
    rodando = true;
    try {
      await recarregar();
      marcarAoVivo(true);
    } catch {
      marcarAoVivo(false);
    } finally {
      rodando = false;
    }
  }
  setInterval(rodar, INTERVALO_ATUALIZACAO_MS);
  document.addEventListener('visibilitychange', rodar);
  window.addEventListener('online', rodar);
}

// ---------- componentes ----------

let temporizadorToast;
function avisar(mensagem, tipo = 'ok') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = mensagem;
  el.className = `toast ${tipo} visivel`;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.classList.remove('visivel'), 3000);
}

function kpi({ rotulo, valor, extra = '', destaque = false }) {
  return `<div class="kpi${destaque ? ' destaque' : ''}">
    <div class="rotulo">${esc(rotulo)}</div>
    <div class="valor">${esc(valor)}</div>
    ${extra ? `<div class="extra">${esc(extra)}</div>` : ''}
  </div>`;
}

/** Barras horizontais com rótulo, valor e percentual. */
function barras(itens) {
  if (!itens.length) return '<p class="vazio">Sem movimento no período.</p>';
  return `<div class="barras">${itens.map((i) => `
    <div class="barra-item">
      <div class="topo-barra"><span>${esc(i.rotulo)}</span><span>${esc(i.valor)} <span class="mudo">· ${porcento(i.pct)}</span></span></div>
      <div class="trilho"><div class="preenchimento" style="width:${Math.max(0, Math.min(100, i.pct))}%"></div></div>
    </div>`).join('')}</div>`;
}

/** Gráfico de colunas em SVG (sem biblioteca). Rótulos em HTML pra não distorcer com a largura. */
function graficoColunas(itens, formatar) {
  if (!itens.length) return '<p class="vazio">Sem dados.</p>';
  const L = 640;
  const A = 200;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  const passo = L / itens.length;
  const larguraColuna = Math.max(2, Math.min(42, passo * 0.68));
  const cadaQuantos = Math.ceil(itens.length / 8);

  const linhas = [0.25, 0.5, 0.75, 1].map((f) => {
    const y = A * (1 - f) + 1;
    return `<line class="grade-linha" x1="0" x2="${L}" y1="${y}" y2="${y}" vector-effect="non-scaling-stroke" />`;
  }).join('');

  const colunas = itens.map((item, i) => {
    const h = (item.valor / max) * (A - 2);
    const x = passo * i + (passo - larguraColuna) / 2;
    return `<rect class="coluna" x="${x}" y="${A - h}" width="${larguraColuna}" height="${Math.max(h, item.valor ? 2 : 0)}">
      <title>${esc(item.rotulo)}: ${esc(formatar(item.valor))}</title></rect>`;
  }).join('');

  const rotulos = itens.map((item, i) => (i % cadaQuantos === 0
    ? `<span style="left:${((i + 0.5) / itens.length) * 100}%">${esc(item.rotulo)}</span>`
    : '')).join('');

  return `<svg class="grafico" viewBox="0 0 ${L} ${A}" preserveAspectRatio="none" role="img"
    aria-label="Faturamento por dia">${linhas}${colunas}</svg>
    <div class="grafico-eixo">${rotulos}</div>
    <p class="mudo" style="font-size:.8rem;margin-top:8px">Maior dia: ${esc(formatar(max))}</p>`;
}

/** Liga um grupo de chips de seleção única. */
function grupoDeChips(container, aoEscolher) {
  container.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip || !container.contains(chip)) return;
    container.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    aoEscolher(chip.dataset.valor, chip);
  });
}
