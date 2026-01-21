# Base image
FROM node:20-alpine AS base

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

# Backend dependencies
FROM base AS backend-deps
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci
RUN npx prisma generate

# Frontend dependencies
FROM base AS frontend-deps
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

# Build backend
FROM backend-deps AS backend-build
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Build frontend
FROM frontend-deps AS frontend-build
COPY frontend/ ./
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ gcc

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies
RUN npm ci --omit=dev
RUN npx prisma generate

# Copy built backend
COPY --from=backend-build /app/dist ./dist/

# Copy Prisma generated client to the correct location
COPY --from=backend-build /app/src/generated ./dist/generated/

# Copy built frontend
COPY --from=frontend-build /app/dist/public ./dist/public/

# Create data directory for SQLite
RUN mkdir -p /data

# Environment
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/app.db
ENV PORT_ADMIN=3000
ENV PORT_PROXY=3001

# Expose ports
EXPOSE 3000 3001

# Run migrations and start
CMD npx prisma migrate deploy && npm start
