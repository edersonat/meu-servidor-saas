'use strict';
const { criarApp } = require('./src/app');
const config = require('./src/config');

if (config.NA_RAILWAY) {
  // Melhor não subir do que subir com PIN padrão ou sem volume (o caixa seria apagado a cada deploy).
  const faltando = [];
  if (!process.env.ADMIN_PIN) faltando.push('a variável ADMIN_PIN (PIN do dono)');
  if (!process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    faltando.push('um volume ligado ao serviço (sem ele os dados somem a cada deploy)');
  }
  if (faltando.length) {
    console.error(`[erro] Configuração incompleta no Railway. Falta: ${faltando.join('; ')}.`);
    console.error('[erro] Veja a seção "Colocar na internet (Railway)" do README.');
    process.exit(1);
  }
} else if (!process.env.ADMIN_PIN) {
  console.warn('[aviso] ADMIN_PIN não definido — usando o PIN padrão "1234". Troque antes de usar de verdade.');
}

const servidor = criarApp();
servidor.listen(config.PORT, () => {
  console.log(`Caixa da barbearia rodando na porta ${config.PORT} (dados em ${config.DATA_DIR})`);
});

// O Railway manda SIGTERM antes de trocar a versão: fecha o banco direitinho.
function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando...`);
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);
