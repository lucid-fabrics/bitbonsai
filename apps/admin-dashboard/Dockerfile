FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY nx.json ./
COPY tsconfig.base.json ./

RUN npm ci --legacy-peer-deps

COPY apps/admin-dashboard ./apps/admin-dashboard
COPY libs ./libs

RUN npx nx build admin-dashboard --prod

FROM nginx:alpine

COPY --from=builder /app/dist/apps/admin-dashboard/browser /usr/share/nginx/html

COPY apps/admin-dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
