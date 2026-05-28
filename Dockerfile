FROM node:lts-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      pipx && \
    pipx install streamlink && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ src/
COPY public/ public/

EXPOSE 3000
CMD ["node", "src/server.js"]
