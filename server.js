'use strict';
const { criarApp } = require('./src/app');
const config = require('./src/config');

if (!process.env.ADMIN_PIN) {
  console.warn('[aviso] ADMIN_PIN não definido — usando o PIN padrão "1234". Troque antes de usar de verdade.');
}

const servidor = criarApp();
servidor.listen(config.PORT, () => {
  console.log(`Caixa da barbearia rodando em http://localhost:${config.PORT}`);
});
