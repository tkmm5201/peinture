# Stage 1: Build the React application
FROM node:20-alpine AS builder

# Pin pnpm to the same major version used for development (avoids corepack pulling latest)
ARG PNPM_VERSION=10.33.0
# npm registry mirror (override with --build-arg NPM_REGISTRY=... for overseas builds)
ARG NPM_REGISTRY=https://registry.npmmirror.com
# corepack downloads the pnpm binary from this registry on first run
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
RUN corepack enable pnpm && corepack prepare pnpm@${PNPM_VERSION} --activate
RUN pnpm config set registry ${NPM_REGISTRY}

WORKDIR /app

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Set proxy URL specifically for the Docker build to use internal Nginx proxy
ENV VITE_PROXY_URL=/proxy

# Build the project
RUN pnpm build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
