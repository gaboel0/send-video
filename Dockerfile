# Imagem única para API e worker (o comando define qual processo roda)
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts=false
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build /app/apps/api/src/generated apps/api/src/generated
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 4000
# API por padrão; o worker usa: node apps/api/dist/worker.js
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/server.js"]
