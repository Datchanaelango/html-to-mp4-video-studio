# Base Node image
FROM node:22-bookworm-slim

# Install Chromium, FFmpeg and core fonts for rich animation rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    fonts-roboto \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use installed Chromium binary
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PORT=3000 \
    NODE_ENV=production

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Ensure storage directories exist
RUN mkdir -p uploads outputs

EXPOSE 3000

CMD ["node", "server.js"]
