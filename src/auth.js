'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VALIDADE_TOKEN_MS = 12 * 60 * 60 * 1000; // um turno
const MAX_TENTATIVAS = 8;
const JANELA_BLOQUEIO_MS = 15 * 60 * 1000;

function hashPin(pin) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), sal, 32).toString('hex');
  return `${sal}:${hash}`;
}

function conferirPin(pin, guardado) {
  const [sal, hash] = String(guardado).split(':');
  if (!sal || !hash) return false;
  const calculado = crypto.scryptSync(String(pin), sal, 32);
  return crypto.timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

/** Compara dois textos sem vazar o tamanho/conteúdo pelo tempo de resposta. */
function compararSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function assinar(texto, segredo) {
  return crypto.createHmac('sha256', segredo).update(texto).digest('base64url');
}

function criarToken(dados, segredo) {
  const corpo = Buffer.from(JSON.stringify({ ...dados, exp: Date.now() + VALIDADE_TOKEN_MS })).toString('base64url');
  return `${corpo}.${assinar(corpo, segredo)}`;
}

function lerToken(token, segredo) {
  if (typeof token !== 'string') return null;
  const [corpo, assinatura] = token.split('.');
  if (!corpo || !assinatura) return null;
  const esperada = assinar(corpo, segredo);
  if (assinatura.length !== esperada.length
    || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return null;
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    return dados.exp > Date.now() ? dados : null;
  } catch {
    return null;
  }
}

/** Usa SECRET do ambiente ou gera um e guarda no diretório de dados. */
function carregarSegredo(dataDir) {
  if (process.env.SECRET) return process.env.SECRET;
  const arquivo = path.join(dataDir, '.segredo');
  try {
    return fs.readFileSync(arquivo, 'utf8').trim();
  } catch {
    const novo = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(arquivo, novo, { mode: 0o600 });
    return novo;
  }
}

/** Trava o login por IP depois de muitas tentativas erradas (PIN é curto). */
function criarLimitadorLogin() {
  const tentativas = new Map();
  return {
    bloqueado(ip) {
      const t = tentativas.get(ip);
      if (!t) return false;
      if (Date.now() - t.inicio > JANELA_BLOQUEIO_MS) {
        tentativas.delete(ip);
        return false;
      }
      return t.falhas >= MAX_TENTATIVAS;
    },
    falhou(ip) {
      const t = tentativas.get(ip);
      if (!t || Date.now() - t.inicio > JANELA_BLOQUEIO_MS) tentativas.set(ip, { inicio: Date.now(), falhas: 1 });
      else t.falhas += 1;
    },
    acertou(ip) {
      tentativas.delete(ip);
    },
  };
}

module.exports = {
  hashPin, conferirPin, compararSeguro, criarToken, lerToken, carregarSegredo, criarLimitadorLogin,
};
