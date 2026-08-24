# Production Node.js Backend Container
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Copy Mobitel Portfolio PDF into backend context if needed
COPY ["SLTMobitel Product & Solution Portfolio - Knowledge Base v1 (1).pdf", "./"]

ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "server.js"]
