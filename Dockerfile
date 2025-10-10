# 🌳 BitBonsai Multi-Stage Dockerfile
# Builds both Angular frontend and NestJS backend in one optimized image

# Stage 1: Build Angular Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy Angular source
COPY angular.json tsconfig.json ./
COPY apps/frontend ./apps/frontend

# Build Angular app
RUN npm run build

# Stage 2: Build NestJS Backend
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy NestJS source
COPY tsconfig.json ./
COPY apps/backend ./apps/backend

# Build NestJS app
RUN npm run build:api

# Stage 3: Production Runtime
FROM node:20-alpine

WORKDIR /app

# SECURITY: Create non-privileged user to run the application
# Running as root is a security risk - use dedicated user instead
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built backend from builder
COPY --from=backend-builder /app/dist/apps/backend ./dist/apps/backend

# Copy built frontend from builder
COPY --from=frontend-builder /app/dist/apps/frontend ./dist/apps/frontend

# Create media and downloads directories with correct permissions
RUN mkdir -p /media /downloads /app/data && \
    chown -R nodejs:nodejs /app /media /downloads

# SECURITY: Switch to non-privileged user
USER nodejs

# Expose ports
EXPOSE 3000 4200

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start backend (serves frontend static files)
CMD ["node", "dist/apps/backend/main.js"]
