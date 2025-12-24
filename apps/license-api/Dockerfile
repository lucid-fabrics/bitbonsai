FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY nx.json ./
COPY tsconfig.base.json ./

RUN npm ci --legacy-peer-deps

COPY apps/license-api ./apps/license-api
COPY libs ./libs

RUN npx nx build license-api --prod

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist/apps/license-api ./
COPY --from=builder /app/apps/license-api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

RUN npx prisma generate

EXPOSE 3000

CMD ["node", "main.js"]
