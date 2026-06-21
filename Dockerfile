FROM node:20-alpine AS builder

WORKDIR /app

# Instala o openssl essencial para o Prisma funcionar no Alpine
RUN apk update && apk add --no-cache openssl

# Copia os arquivos de dependência
COPY package*.json ./
COPY prisma ./prisma/

# Instala as dependências (incluindo devDependencies necessárias pro build)
RUN npm install

# Copia todo código fonte
COPY . .

# Faz o build (o package.json já roda 'prisma generate' antes do build)
RUN npm run build

# --- Estágio de Produção ---
FROM node:20-alpine AS runner

WORKDIR /app

# Instala o openssl essencial para o Prisma no Alpine
RUN apk update && apk add --no-cache openssl

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Variáveis de Ambiente
ENV NODE_ENV=production
ENV PORT=3000

# O Coolify vai mapear a porta automaticamente
EXPOSE 3000

# Executa o prisma db push antes de inicializar o servidor para garantir
# que o banco de dados esteja atualizado a cada novo deploy.
CMD ["sh", "-c", "npx prisma db push && npm start"]
