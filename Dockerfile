# ----------  base image ----------
FROM node:22-alpine As base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ----------  runtime image ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY . .
CMD ["node", "src/index.js"]
