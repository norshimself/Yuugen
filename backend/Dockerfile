# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDeps for build)
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# ---- Stage 2: Production ----
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
USER nestjs

EXPOSE 3000

CMD ["node", "dist/main"]
