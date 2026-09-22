# aiManager 远程 Streamable HTTP MCP 镜像
# 作用：只提供无状态 MCP 转发服务，不在镜像中写入任何员工或平台凭据
FROM node:20-alpine AS build

RUN apk add --no-cache python3 make g++ libsecret-dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache libsecret
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/mcp-http.js"]
