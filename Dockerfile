FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Sem dependências externas: só copia o código.
COPY package.json server.js ./
COPY src ./src
COPY public ./public

# Roda como root de propósito: o volume do Railway é montado com dono root
# e o banco (SQLite) precisa escrever nele.
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
