# ============================================================
# 平台前端镜像：Next.js（standalone 输出）
# 构建：docker compose build web
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /app

# 前端构建时需要注入后端地址（浏览器通过同域 /api 访问）
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_DEV_USER_PICKER=false
ARG NEXT_PUBLIC_UPLOAD_MAX_MB=100
ARG NEXT_PUBLIC_AVATAR_MAX_MB=5
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_DEV_USER_PICKER=${NEXT_PUBLIC_DEV_USER_PICKER}
ENV NEXT_PUBLIC_UPLOAD_MAX_MB=${NEXT_PUBLIC_UPLOAD_MAX_MB}
ENV NEXT_PUBLIC_AVATAR_MAX_MB=${NEXT_PUBLIC_AVATAR_MAX_MB}

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json next.config.mjs ./
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
RUN npm run build

# ---------------- 运行阶段 ----------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# standalone 产物已包含精简后的依赖
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
