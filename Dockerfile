FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV HOST=0.0.0.0
ENV PORT=3000
ENV MCP_TRANSPORT=http

EXPOSE 3000

CMD ["npm", "run", "start:http"]
