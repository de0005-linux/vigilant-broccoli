FROM mcr.microsoft.com/playwright:v1.54.2-noble
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data PROFILE_DIR=/data/chromium-profile BROWSER_HEADLESS=true
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs ./
COPY public ./public
RUN mkdir -p /data/chromium-profile /data/downloads
EXPOSE 3000
CMD ["node","server.mjs"]
