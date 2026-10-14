'use strict';
const path = require('node:path');

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  TZ: process.env.TZ_BARBEARIA || 'America/Sao_Paulo',
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
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
