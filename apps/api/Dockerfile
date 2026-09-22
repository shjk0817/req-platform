# ============================================================
# 平台后端镜像：NestJS + Prisma
# 构建：docker compose build api
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /app

# Prisma 在 alpine 上依赖 openssl
RUN apk add --no-cache openssl libc6-compat

# 先安装依赖，充分利用镜像层缓存
COPY package.json ./
RUN npm install --no-audit --no-fund

# 生成 Prisma Client（需要 schema）
COPY prisma ./prisma
RUN npx prisma generate

# 编译 TypeScript
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------------- 运行阶段 ----------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Prisma 查询引擎在 alpine 上需要 openssl
RUN apk add --no-cache openssl libc6-compat

# 安装生产依赖（prisma CLI 在 dependencies 中，用于执行数据库迁移）
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# 复用已生成的 Prisma Client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]
