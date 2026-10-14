'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarApp } = require('../src/app');

async function iniciar(t, opcoes = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caixa-teste-'));
  const servidor = criarApp({ dataDir, adminPin: '9999', segredo: 'segredo-de-teste', confiarProxy: false, ...opcoes });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  t.after(() => {
    servidor.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;

  return async function chamar(metodo, url, { corpo, token, ip } = {}) {
    const res = await fetch(base + url, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { 'X-Real-IP': ip } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: res.status, dados: await res.json().catch(() => null) };
  };
}

test('fluxo completo: dono cadastra, barbeiro lança, painel consolida', async (t) => {
  const chamar = await iniciar(t);

  // login do dono
  assert.equal((await chamar('POST', '/api/login', { corpo: { papel: 'admin', pin: '0000' } })).status, 401);
  const admin = (await chamar('POST', '/api/login', { corpo: { papel: 'admin', pin: '9999' } })).dados.token;
  assert.ok(admin);

  // rotas do dono exigem token de dono
  assert.equal((await chamar('GET', '/api/admin/resumo')).status, 401);

  // cadastro de barbeiros
  const ana = await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'Ana', comissao: 50, pin: '1111' } });
  assert.equal(ana.status, 201);
  const bruno = await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'Bruno', comissao: 40, pin: '2222' } });
  assert.equal(bruno.status, 201);
  assert.equal((await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'ana', comissao: 50, pin: '3333' } })).status, 409);
  assert.equal((await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'Caio', comissao: 150, pin: '3333' } })).status, 400);
  assert.equal((await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'Caio', comissao: 40, pin: '12' } })).status, 400);
  assert.deepEqual((await chamar('GET', '/api/barbeiros')).dados.map((b) => b.nome), ['Ana', 'Bruno']);

  // login do barbeiro
  assert.equal((await chamar('POST', '/api/login', { corpo: { papel: 'barbeiro', barbeiro_id: ana.dados.id, pin: '2222' } })).status, 401);
  const tokenAna = (await chamar('POST', '/api/login', { corpo: { papel: 'barbeiro', barbeiro_id: ana.dados.id, pin: '1111' } })).dados.token;
  const tokenBruno = (await chamar('POST', '/api/login', { corpo: { papel: 'barbeiro', barbeiro_id: bruno.dados.id, pin: '2222' } })).dados.token;

  // barbeiro não acessa o painel do dono
  assert.equal((await chamar('GET', '/api/admin/resumo', { token: tokenAna })).status, 403);

  // lançamentos
  const corte = await chamar('POST', '/api/eu/atendimentos', { token: tokenAna, corpo: { servico: 'Corte', valor_centavos: 4000, forma_pagamento: 'Pix' } });
  assert.equal(corte.status, 201);
  assert.equal(corte.dados.ganho_centavos, 2000);
  await chamar('POST', '/api/eu/atendimentos', { token: tokenAna, corpo: { servico: 'Corte + Barba', valor_centavos: 6500, forma_pagamento: 'Dinheiro' } });
  await chamar('POST', '/api/eu/atendimentos', { token: tokenBruno, corpo: { servico: 'Barba', valor_centavos: 3000, forma_pagamento: 'Pix' } });
  assert.equal((await chamar('POST', '/api/eu/atendimentos', { token: tokenAna, corpo: { servico: 'Corte', valor_centavos: -10, forma_pagamento: 'Pix' } })).status, 400);
  assert.equal((await chamar('POST', '/api/eu/atendimentos', { token: tokenAna, corpo: { servico: 'Corte', valor_centavos: 4000, forma_pagamento: 'Fiado' } })).status, 400);

  // visão do barbeiro: só os próprios números
  const meu = (await chamar('GET', '/api/eu/resumo', { token: tokenAna })).dados;
  assert.equal(meu.resumo.cortes, 2);
  assert.equal(meu.resumo.faturamento, 10500);
  assert.equal(meu.resumo.ticket_medio, 5250);
  assert.equal(meu.resumo.comissao_barbeiros, 5250);
  assert.equal(meu.atendimentos.length, 2);

  // barbeiro não exclui lançamento de outro
  assert.equal((await chamar('DELETE', `/api/eu/atendimentos/${corte.dados.id}`, { token: tokenBruno })).status, 404);

  // painel do dono
  const painel = (await chamar('GET', '/api/admin/resumo', { token: admin })).dados.resumo;
  assert.equal(painel.cortes, 3);
  assert.equal(painel.faturamento, 13500);
  assert.equal(painel.ticket_medio, 4500);
  assert.equal(painel.comissao_barbeiros, 6450);
  assert.equal(painel.lucro_casa, 7050);
  assert.deepEqual(painel.por_barbeiro.map((b) => [b.nome, b.cortes, b.ganho]), [['Ana', 2, 5250], ['Bruno', 1, 1200]]);

  // mudar comissão não altera o histórico
  await chamar('PATCH', `/api/admin/barbeiros/${ana.dados.id}`, { token: admin, corpo: { comissao: 60 } });
  assert.equal((await chamar('GET', '/api/admin/resumo', { token: admin })).dados.resumo.comissao_barbeiros, 6450);

  // barbeiro exclui o próprio lançamento de hoje
  assert.equal((await chamar('DELETE', `/api/eu/atendimentos/${corte.dados.id}`, { token: tokenAna })).status, 200);
  assert.equal((await chamar('GET', '/api/eu/resumo', { token: tokenAna })).dados.resumo.cortes, 1);

  // trocar o PIN derruba a sessão antiga
  await chamar('PATCH', `/api/admin/barbeiros/${bruno.dados.id}`, { token: admin, corpo: { pin: '5555' } });
  assert.equal((await chamar('GET', '/api/eu', { token: tokenBruno })).status, 401);

  // excluir barbeiro com histórico: some da equipe, mas o caixa continua igual
  const remocao = await chamar('DELETE', `/api/admin/barbeiros/${bruno.dados.id}`, { token: admin });
  assert.equal(remocao.dados.resultado, 'desativado');
  assert.deepEqual((await chamar('GET', '/api/barbeiros')).dados.map((b) => b.nome), ['Ana']);
  const depois = (await chamar('GET', '/api/admin/resumo', { token: admin })).dados.resumo;
  assert.equal(depois.faturamento, 9500);
  assert.equal(depois.por_barbeiro.find((b) => b.nome === 'Bruno').ativo, false);

  // excluir barbeiro sem histórico apaga de vez
  const novo = await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'Davi', comissao: 45, pin: '4444' } });
  assert.equal((await chamar('DELETE', `/api/admin/barbeiros/${novo.dados.id}`, { token: admin })).dados.resultado, 'apagado');
});

test('validação de período e rotas desconhecidas', async (t) => {
  const chamar = await iniciar(t);
  const admin = (await chamar('POST', '/api/login', { corpo: { papel: 'admin', pin: '9999' } })).dados.token;
  assert.equal((await chamar('GET', '/api/admin/resumo?inicio=2026-13-01', { token: admin })).status, 400);
  assert.equal((await chamar('GET', '/api/admin/resumo?inicio=2026-10-10&fim=2026-10-01', { token: admin })).status, 400);
  assert.equal((await chamar('GET', '/api/admin/resumo?inicio=2024-01-01&fim=2026-01-01', { token: admin })).status, 400);
  const ok = await chamar('GET', '/api/admin/resumo?inicio=2026-10-01&fim=2026-10-07', { token: admin });
  assert.equal(ok.status, 200);
  assert.equal(ok.dados.resumo.por_dia.length, 7);
  assert.equal((await chamar('GET', '/api/nao-existe')).status, 404);
});

test('trava o login depois de muitas tentativas erradas', async (t) => {
  const chamar = await iniciar(t);
  for (let i = 0; i < 8; i++) await chamar('POST', '/api/login', { corpo: { papel: 'admin', pin: '0000' } });
  assert.equal((await chamar('POST', '/api/login', { corpo: { papel: 'admin', pin: '9999' } })).status, 429);
});

test('rota de saúde pro healthcheck do Railway', async (t) => {
  const chamar = await iniciar(t);
  assert.deepEqual(await chamar('GET', '/api/saude'), { status: 200, dados: { ok: true } });
});

test('sem proxy confiável, o cabeçalho X-Real-IP é ignorado', async (t) => {
  const chamar = await iniciar(t);
  for (let i = 0; i < 8; i++) {
    await chamar('POST', '/api/login', { ip: `10.0.0.${i}`, corpo: { papel: 'admin', pin: '0000' } });
  }
  assert.equal((await chamar('POST', '/api/login', { ip: '10.0.0.99', corpo: { papel: 'admin', pin: '9999' } })).status, 429);
});

test('atrás do proxy, a trava por IP usa o IP real de quem acessa', async (t) => {
  const chamar = await iniciar(t, { confiarProxy: true });
  for (let i = 0; i < 8; i++) await chamar('POST', '/api/login', { ip: '1.1.1.1', corpo: { papel: 'admin', pin: '0000' } });
  assert.equal((await chamar('POST', '/api/login', { ip: '1.1.1.1', corpo: { papel: 'admin', pin: '9999' } })).status, 429);
  assert.equal((await chamar('POST', '/api/login', { ip: '2.2.2.2', corpo: { papel: 'admin', pin: '9999' } })).status, 200);
});

test('trocar de IP não adianta: a conta trava depois de 20 PINs errados', async (t) => {
  const chamar = await iniciar(t, { confiarProxy: true });
  const admin = (await chamar('POST', '/api/login', { corpo: { papel: 'admin', pin: '9999' } })).dados.token;
  const ana = (await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'Ana', comissao: 50, pin: '1111' } })).dados;
  const bruno = (await chamar('POST', '/api/admin/barbeiros', { token: admin, corpo: { nome: 'Bruno', comissao: 50, pin: '2222' } })).dados;

  for (let i = 0; i < 20; i++) {
    await chamar('POST', '/api/login', { ip: `9.9.9.${i}`, corpo: { papel: 'barbeiro', barbeiro_id: ana.id, pin: '0000' } });
  }
  const login = (id, pin) => chamar('POST', '/api/login', { ip: '8.8.8.8', corpo: { papel: 'barbeiro', barbeiro_id: id, pin } });
  assert.equal((await login(ana.id, '1111')).status, 429, 'conta da Ana travada');
  assert.equal((await login(bruno.id, '2222')).status, 200, 'outras contas seguem normais');
});

test('lista de atendimentos informa o dia atual (pra virada de dia na tela)', async (t) => {
  const chamar = await iniciar(t);
  const admin = (await chamar('POST', '/api/login', { corpo: { papel: 'admin', pin: '9999' } })).dados.token;
  const r = await chamar('GET', '/api/admin/atendimentos', { token: admin });
  assert.match(r.dados.hoje, /^\d{4}-\d{2}-\d{2}$/);
});
