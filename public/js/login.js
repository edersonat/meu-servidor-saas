'use strict';

const destinos = { barbeiro: '/barbeiro.html', admin: '/admin.html' };
if (Sessao.token && destinos[Sessao.papel]) location.replace(destinos[Sessao.papel]);

const formBarbeiro = document.getElementById('form-barbeiro');
const formAdmin = document.getElementById('form-admin');
const erro = document.getElementById('erro');

document.querySelectorAll('.aba').forEach((aba) => {
  aba.addEventListener('click', () => {
    document.querySelectorAll('.aba').forEach((a) => a.setAttribute('aria-selected', String(a === aba)));
    formBarbeiro.hidden = aba.dataset.alvo !== 'form-barbeiro';
    formAdmin.hidden = aba.dataset.alvo !== 'form-admin';
    erro.textContent = '';
  });
});

async function carregar() {
  try {
    const [cfg, barbeiros] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/barbeiros')]);
    document.getElementById('nome-barbearia').textContent = cfg.nome_barbearia;
    document.title = `Caixa · ${cfg.nome_barbearia}`;
    const select = formBarbeiro.elements.barbeiro_id;
    select.innerHTML = '<option value="">Escolha…</option>'
      + barbeiros.map((b) => `<option value="${b.id}">${esc(b.nome)}</option>`).join('');
    document.getElementById('sem-barbeiros').hidden = barbeiros.length > 0;
  } catch (e) {
    erro.textContent = e.message;
  }
}

async function entrar(form, corpo) {
  erro.textContent = '';
  const botao = form.querySelector('button');
  botao.disabled = true;
  try {
    const r = await api('POST', '/api/login', corpo);
    Sessao.salvar(r.token, r.papel);
    location.href = destinos[r.papel];
  } catch (e) {
    erro.textContent = e.message;
    form.elements.pin.value = '';
    form.elements.pin.focus();
  } finally {
    botao.disabled = false;
  }
}

formBarbeiro.addEventListener('submit', (ev) => {
  ev.preventDefault();
  entrar(formBarbeiro, {
    papel: 'barbeiro',
    barbeiro_id: Number(formBarbeiro.elements.barbeiro_id.value),
    pin: formBarbeiro.elements.pin.value,
  });
});

formAdmin.addEventListener('submit', (ev) => {
  ev.preventDefault();
  entrar(formAdmin, { papel: 'admin', pin: formAdmin.elements.pin.value });
});

carregar();
