FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY server-cloudrun.js ./server.js
COPY public ./public

# Cloud Run uses PORT env var
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
