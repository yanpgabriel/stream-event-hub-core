FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json ./
COPY server/package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY server/ .

EXPOSE 3232

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "const http=require('http');const port=Number(process.env.PORT||3232);const req=http.get({host:'127.0.0.1',port,path:'/api/health/ready',timeout:4000},(res)=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.on('timeout',()=>{req.destroy();process.exit(1);});"

CMD ["node", "index.js"]
