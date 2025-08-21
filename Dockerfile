FROM node:18-alpine

# Install git, build tools, and ffmpeg
# Note: Using --update followed by rm -rf /var/cache/apk/* helps keep the image smaller
RUN apk update && apk add --no-cache git python3 make g++ ffmpeg && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Expose the port (if your app uses one, like 3000)
# EXPOSE 3000

# Run the bot
CMD ["npm", "start"]
