FROM oven/bun:1.4.2-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS frontend
COPY web/ ./web/
COPY shared/ ./shared/
RUN bun run --cwd web build

FROM oven/bun:1.4.2-alpine AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:22-alpine
WORKDIR /app/server
ENV NODE_ENV=production
ENV STREAM_HUB_DATA_DIR=/app/data
COPY --from=production-dependencies /app/node_modules /app/node_modules
COPY server/ /app/server/
COPY shared/ /app/shared/
COPY --from=frontend /app/web/dist /app/web/dist

EXPOSE 3232

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const http=require('http');const port=Number(process.env.PORT||3232);const req=http.get({host:'127.0.0.1',port,path:'/api/health/ready',timeout:4000},(res)=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1);});"

CMD ["node", "index.js"]
