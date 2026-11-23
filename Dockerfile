# The full app, with live mode, for a public server.
# Set these on the host, never in the repo:
#   GEMINI_API_KEY   your own Gemini API key
#   ACCESS_CODE      the code visitors must enter before they can record
# Optional:
#   LIVE_DAILY_LIMIT how many recordings to allow per day (default 40)
#   RETAIN_MINUTES   how long a visitor's recording is kept (default 30)
FROM node:22-slim

WORKDIR /app

# ffmpeg comes from the ffmpeg-static package, which fetches its binary on install.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOSTED=1
ENV PORT=10000
EXPOSE 10000

CMD ["npx", "tsx", "server/index.ts"]
