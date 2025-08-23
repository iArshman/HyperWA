FROM node:18-alpine

# Install build dependencies for node-canvas, ffmpeg, and other native modules
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    tzdata \
    haveged \
    pkgconfig \
    pixman-dev \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    ffmpeg

# Set timezone
ENV TZ=Asia/Karachi
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Start haveged and bot
CMD ["sh", "-c", "haveged -F & npm start"]
