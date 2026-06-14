# Use an official Node runtime as a parent image
FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Capture the API_URL build argument and set it as an ENV so Next.js reads it
ARG API_URL
ENV API_URL=$API_URL

# Copy the rest of the application
COPY . .

# Build the Next.js app
RUN npm run build

# Expose the port Next.js runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
