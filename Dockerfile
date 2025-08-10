# ---------- base image ----------
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---------- runtime image ----------
FROM node:22-alpine
WORKDIR /app

# Time zone inside the image (independent of the host)
RUN apk add --no-cache tzdata
ENV TZ=Asia/Jerusalem
# Link zoneinfo so system tools read the correct time zone
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV NODE_ENV=production

# Node dependencies from the build stage
COPY --from=base /app/node_modules ./node_modules

# Application code (includes service-account.json at the project root)
COPY . .

CMD ["node", "src/index.js"]
