FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY nx.json ./
COPY tsconfig.base.json ./

RUN npm ci

COPY apps/website ./apps/website
COPY libs ./libs

RUN npx nx build website --prod

FROM nginx:alpine

COPY --from=builder /app/dist/apps/website/browser /usr/share/nginx/html

COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
