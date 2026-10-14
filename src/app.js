'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const auth = require('./auth');
const datas = require('./datas');
const { abrirBanco } = require('./db');
const { resumir, ganhoDoBarbeiro } = require('./stats');

const PASTA_PUBLICA = path.join(__dirname, '..', 'public');
const MAX_CORPO_BYTES = 16 * 1024;
const MAX_PERIODO_DIAS = 366;
const MAX_VALOR_CENTAVOS = 1_000_000; // R$ 10.000 por atendimento
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// ---------- validação ----------

function validarNome(valor) {
  const nome = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (nome.length < 2 || nome.length > 60) throw new ErroHttp(400, 'O nome precisa ter entre 2 e 60 letras.');
  return nome;
}

function validarComissao(valor) {
  const n = Number(valor);
  if (valor === '' || valor === null || !Number.isFinite(n) || n < 0 || n > 100) {
    throw new ErroHttp(400, 'A comissão precisa ser um número entre 0 e 100.');
  }
  return Math.round(n * 10) / 10;
}

function validarPin(valor) {
  const pin = String(valor ?? '');
  if (!/^\d{4,6}$/.test(pin)) throw new ErroHttp(400, 'O PIN precisa ter de 4 a 6 números.');
  return pin;
}

function validarId(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ErroHttp(400, 'Identificador inválido.');
  return id;
}

function validarAtendimento(corpo) {
  const servico = String(corpo.servico ?? '').trim().replace(/\s+/g, ' ');
  if (servico.length < 1 || servico.length > 60) throw new ErroHttp(400, 'Informe o serviço (até 60 letras).');
  const valorCentavos = Number(corpo.valor_centavos);
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0 || valorCentavos > MAX_VALOR_CENTAVOS) {
    throw new ErroHttp(400, 'Valor inválido.');
  }
  const formaPagamento = String(corpo.forma_pagamento ?? '');
  if (!config.FORMAS_PAGAMENTO.includes(formaPagamento)) throw new ErroHttp(400, 'Forma de pagamento inválida.');
  return { servico, valorCentavos, formaPagamento };
}

// ---------- formatação de saída ----------

function barbeiroPublico(b) {
  return { id: b.id, nome: b.nome, comissao: b.comissao, ativo: Boolean(b.ativo), criado_em: b.criado_em };
}

function atendimentoPublico(a) {
  return { ...a, ganho_centavos: ganhoDoBarbeiro(a) };
}

// ---------- HTTP ----------

function enviarJson(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

function lerJson(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho > MAX_CORPO_BYTES) {
        reject(new ErroHttp(413, 'Requisição grande demais.'));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try {
        const dados = JSON.parse(Buffer.concat(partes).toString('utf8'));
        resolve(dados && typeof dados === 'object' ? dados : {});
      } catch {
        reject(new ErroHttp(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function servirEstatico(req, res, caminho) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const relativo = caminho === '/' ? '/index.html' : caminho;
  const arquivo = path.normalize(path.join(PASTA_PUBLICA, decodeURIComponent(relativo)));
  if (!arquivo.startsWith(PASTA_PUBLICA + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Página não encontrada');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : conteudo);
  });
}

// ---------- aplicação ----------

function criarApp(opcoes = {}) {
  const dataDir = opcoes.dataDir || config.DATA_DIR;
  const tz = opcoes.tz || config.TZ;
  const adminPin = String(opcoes.adminPin || config.ADMIN_PIN);
  const confiarProxy = opcoes.confiarProxy ?? config.CONFIAR_PROXY;
  fs.mkdirSync(dataDir, { recursive: true });

  const db = abrirBanco(opcoes.arquivoBanco || path.join(dataDir, 'barbearia.db'));
  const segredo = opcoes.segredo || auth.carregarSegredo(dataDir);
  const limitadorIp = auth.criarLimitadorLogin(auth.MAX_TENTATIVAS_IP);
  const limitadorConta = auth.criarLimitadorLogin(auth.MAX_TENTATIVAS_CONTA);
  const hoje = () => datas.agora(tz).data;

  const rotas = [];
  function rota(metodo, padrao, papel, tratador, statusSucesso = 200) {
    const chaves = [];
    const regex = new RegExp(`^${padrao.replace(/:(\w+)/g, (_, chave) => {
      chaves.push(chave);
      return '([^/]+)';
    })}$`);
    rotas.push({ metodo, regex, chaves, papel, tratador, statusSucesso });
  }

  function lerPeriodo(query) {
    const inicio = query.get('inicio') || hoje();
    const fim = query.get('fim') || inicio;
    if (!datas.dataValida(inicio) || !datas.dataValida(fim)) throw new ErroHttp(400, 'Data inválida (use AAAA-MM-DD).');
    if (inicio > fim) throw new ErroHttp(400, 'A data inicial é depois da final.');
    if (datas.tamanhoPeriodo(inicio, fim) > MAX_PERIODO_DIAS) throw new ErroHttp(400, 'Período máximo é de 1 ano.');
    return { inicio, fim };
  }

  function ipDoCliente(req) {
    const real = req.headers['x-real-ip'];
    if (confiarProxy && typeof real === 'string' && real.trim()) return real.trim();
    return req.socket.remoteAddress || 'desconhecido';
  }

  function barbeiroAtivo(id) {
    const b = db.buscarBarbeiro(id);
    if (!b || !b.ativo) throw new ErroHttp(404, 'Barbeiro não encontrado.');
    return b;
  }

  function lancar(barbeiro, corpo) {
    const { servico, valorCentavos, formaPagamento } = validarAtendimento(corpo);
    const { data, hora } = datas.agora(tz);
    return atendimentoPublico(db.criarAtendimento({
      barbeiroId: barbeiro.id, servico, valorCentavos, comissaoPct: barbeiro.comissao, formaPagamento, data, hora,
    }));
  }

  /** Identifica quem está chamando. O token de barbeiro cai se o PIN mudar ou ele for removido. */
  function autenticar(req, papel) {
    const cabecalho = req.headers.authorization || '';
    const sessao = auth.lerToken(cabecalho.replace(/^Bearer\s+/i, ''), segredo);
    if (!sessao) throw new ErroHttp(401, 'Sessão expirada. Entre de novo.');
    if (sessao.papel !== papel) throw new ErroHttp(403, 'Acesso não permitido.');
    if (papel === 'barbeiro') {
      const b = db.buscarBarbeiro(sessao.id);
      if (!b || !b.ativo || b.pin_hash.slice(0, 12) !== sessao.pv) throw new ErroHttp(401, 'Sessão expirada. Entre de novo.');
      return { sessao, barbeiro: b };
    }
    return { sessao };
  }

  // ----- públicas -----

  rota('GET', '/api/saude', null, () => ({ ok: db.saude() }));

  rota('GET', '/api/config', null, () => ({
    nome_barbearia: config.NOME_BARBEARIA,
    hoje: hoje(),
    servicos: config.SERVICOS,
    formas_pagamento: config.FORMAS_PAGAMENTO,
  }));

  rota('GET', '/api/barbeiros', null, () => db.listarBarbeiros().map((b) => ({ id: b.id, nome: b.nome })));

  rota('POST', '/api/login', null, ({ corpo, req }) => {
    if (corpo.papel !== 'admin' && corpo.papel !== 'barbeiro') throw new ErroHttp(400, 'Tipo de acesso inválido.');
    const ip = ipDoCliente(req);
    const conta = corpo.papel === 'admin' ? 'admin' : `barbeiro:${Number(corpo.barbeiro_id)}`;
    if (limitadorIp.bloqueado(ip) || limitadorConta.bloqueado(conta)) {
      throw new ErroHttp(429, 'Muitas tentativas erradas. Espere 15 minutos.');
    }
    const pin = String(corpo.pin ?? '');
    const falhou = (mensagem) => {
      limitadorIp.falhou(ip);
      limitadorConta.falhou(conta);
      return new ErroHttp(401, mensagem);
    };
    const acertou = () => {
      limitadorIp.acertou(ip);
      limitadorConta.acertou(conta);
    };

    if (corpo.papel === 'admin') {
      if (!auth.compararSeguro(pin, adminPin)) throw falhou('PIN incorreto.');
      acertou();
      return { papel: 'admin', token: auth.criarToken({ papel: 'admin' }, segredo) };
    }

    const b = db.buscarBarbeiro(Number(corpo.barbeiro_id));
    if (!b || !b.ativo || !auth.conferirPin(pin, b.pin_hash)) throw falhou('Barbeiro ou PIN incorreto.');
    acertou();
    return {
      papel: 'barbeiro',
      barbeiro: barbeiroPublico(b),
      token: auth.criarToken({ papel: 'barbeiro', id: b.id, pv: b.pin_hash.slice(0, 12) }, segredo),
    };
  });

  // ----- área do barbeiro -----

  rota('GET', '/api/eu', 'barbeiro', ({ barbeiro }) => barbeiroPublico(barbeiro));

  rota('GET', '/api/eu/resumo', 'barbeiro', ({ query, barbeiro }) => {
    const periodo = lerPeriodo(query);
    const atendimentos = db.listarAtendimentos({ ...periodo, barbeiroId: barbeiro.id });
    return {
      periodo,
      hoje: hoje(),
      resumo: resumir(atendimentos, [barbeiro], periodo),
      atendimentos: atendimentos.map(atendimentoPublico),
    };
  });

  rota('POST', '/api/eu/atendimentos', 'barbeiro', ({ corpo, barbeiro }) => lancar(barbeiro, corpo), 201);

  rota('DELETE', '/api/eu/atendimentos/:id', 'barbeiro', ({ params, barbeiro }) => {
    const a = db.buscarAtendimento(validarId(params.id));
    if (!a || a.barbeiro_id !== barbeiro.id) throw new ErroHttp(404, 'Lançamento não encontrado.');
    if (a.data !== hoje()) throw new ErroHttp(403, 'Só dá pra excluir lançamentos de hoje. Fale com o dono.');
    db.apagarAtendimento(a.id);
    return { ok: true };
  });

  // ----- painel do dono -----

  rota('GET', '/api/admin/resumo', 'admin', ({ query }) => {
    const periodo = lerPeriodo(query);
    const atendimentos = db.listarAtendimentos(periodo);
    return { periodo, hoje: hoje(), resumo: resumir(atendimentos, db.listarBarbeiros(), periodo) };
  });

  rota('GET', '/api/admin/atendimentos', 'admin', ({ query }) => {
    const periodo = lerPeriodo(query);
    const barbeiroId = query.get('barbeiro_id') ? validarId(query.get('barbeiro_id')) : undefined;
    return {
      periodo,
      hoje: hoje(),
      atendimentos: db.listarAtendimentos({ ...periodo, barbeiroId }).map(atendimentoPublico),
    };
  });

  rota('POST', '/api/admin/atendimentos', 'admin', ({ corpo }) => {
    const barbeiro = barbeiroAtivo(validarId(corpo.barbeiro_id));
    return lancar(barbeiro, corpo);
  }, 201);

  rota('DELETE', '/api/admin/atendimentos/:id', 'admin', ({ params }) => {
    if (!db.apagarAtendimento(validarId(params.id))) throw new ErroHttp(404, 'Lançamento não encontrado.');
    return { ok: true };
  });

  rota('GET', '/api/admin/barbeiros', 'admin', () => db.listarBarbeiros().map(barbeiroPublico));

  rota('POST', '/api/admin/barbeiros', 'admin', ({ corpo }) => {
    const nome = validarNome(corpo.nome);
    const comissao = validarComissao(corpo.comissao);
    const pin = validarPin(corpo.pin);
    if (db.nomeEmUso(nome)) throw new ErroHttp(409, 'Já existe um barbeiro com esse nome.');
    return barbeiroPublico(db.criarBarbeiro({ nome, comissao, pinHash: auth.hashPin(pin) }));
  }, 201);

  rota('PATCH', '/api/admin/barbeiros/:id', 'admin', ({ params, corpo }) => {
    const atual = barbeiroAtivo(validarId(params.id));
    const mudancas = {};
    if (corpo.nome !== undefined) {
      mudancas.nome = validarNome(corpo.nome);
      if (db.nomeEmUso(mudancas.nome, atual.id)) throw new ErroHttp(409, 'Já existe um barbeiro com esse nome.');
    }
    if (corpo.comissao !== undefined) mudancas.comissao = validarComissao(corpo.comissao);
    if (corpo.pin !== undefined) mudancas.pinHash = auth.hashPin(validarPin(corpo.pin));
    return barbeiroPublico(db.atualizarBarbeiro(atual.id, mudancas));
  });

  rota('DELETE', '/api/admin/barbeiros/:id', 'admin', ({ params }) => {
    const b = barbeiroAtivo(validarId(params.id));
    return { ok: true, resultado: db.removerBarbeiro(b.id) };
  });

  async function tratarApi(req, res, url) {
    const candidatas = rotas.filter((r) => r.regex.test(url.pathname));
    if (!candidatas.length) throw new ErroHttp(404, 'Rota não encontrada.');
    const r = candidatas.find((c) => c.metodo === req.method);
    if (!r) throw new ErroHttp(405, 'Método não permitido.');

    const valores = url.pathname.match(r.regex).slice(1);
    const params = Object.fromEntries(r.chaves.map((chave, i) => [chave, decodeURIComponent(valores[i])]));
    const contexto = r.papel ? autenticar(req, r.papel) : {};
    const corpo = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await lerJson(req) : {};
    const resultado = await r.tratador({ ...contexto, req, params, query: url.searchParams, corpo });
    enviarJson(res, r.statusSucesso, resultado);
  }

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await tratarApi(req, res, url);
      else servirEstatico(req, res, url.pathname);
    } catch (e) {
      let erro = e;
      if (erro instanceof URIError) erro = new ErroHttp(400, 'Endereço inválido.');
      if (!(erro instanceof ErroHttp)) console.error(erro);
      const status = erro instanceof ErroHttp ? erro.status : 500;
      if (!res.headersSent) enviarJson(res, status, { erro: status === 500 ? 'Erro interno no servidor.' : erro.message });
    }
  });
  servidor.on('close', () => db.fechar());
  return servidor;
}

module.exports = { criarApp };
