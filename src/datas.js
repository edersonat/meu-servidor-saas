'use strict';

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Data (YYYY-MM-DD) e hora (HH:MM) atuais no fuso da barbearia. */
function agora(tz) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

function dataValida(texto) {
  if (typeof texto !== 'string' || !RE_DATA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function somarDias(data, n) {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Quantidade de dias do período, contando início e fim. */
function tamanhoPeriodo(inicio, fim) {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / DIA_MS) + 1;
}

function diasEntre(inicio, fim) {
  const dias = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

module.exports = { agora, dataValida, somarDias, tamanhoPeriodo, diasEntre };
