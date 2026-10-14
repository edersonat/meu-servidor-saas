'use strict';
const path = require('node:path');

// O Railway define essas variáveis em todo deploy.
const NA_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);

module.exports = {
  NA_RAILWAY,
  PORT: Number(process.env.PORT) || 3000,
  TZ: process.env.TZ_BARBEARIA || 'America/Sao_Paulo',
  // No Railway, o banco vai pro volume (RAILWAY_VOLUME_MOUNT_PATH é definido quando há um volume ligado).
  DATA_DIR: process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data'),
  // Atrás de um proxy (Railway), o IP de quem acessa vem no cabeçalho X-Real-IP.
  CONFIAR_PROXY: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : NA_RAILWAY,
  ADMIN_PIN: process.env.ADMIN_PIN || '1234',
  NOME_BARBEARIA: process.env.NOME_BARBEARIA || 'Barbearia',

  // Catálogo sugerido na tela de lançamento (valores em centavos).
  // O barbeiro pode alterar o valor na hora de lançar.
  SERVICOS: [
    { nome: 'Corte', valor_centavos: 4000 },
    { nome: 'Barba', valor_centavos: 3000 },
    { nome: 'Corte + Barba', valor_centavos: 6500 },
    { nome: 'Sobrancelha', valor_centavos: 1500 },
    { nome: 'Pezinho', valor_centavos: 1500 },
    { nome: 'Pigmentação', valor_centavos: 3000 },
  ],

  FORMAS_PAGAMENTO: ['Pix', 'Dinheiro', 'Débito', 'Crédito'],
};
