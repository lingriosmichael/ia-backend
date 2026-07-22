FROM node:22.12-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json eslint.config.js ./
COPY src ./src
RUN npm run build

FROM node:22.12-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["npm", "run", "start"]
