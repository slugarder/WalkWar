FROM node:24-slim AS build

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
COPY server/tsconfig.json ./server/
COPY contracts ./contracts
COPY server/src ./server/src
COPY server/data ./server/data

WORKDIR /app/server
RUN npm ci --include=dev
RUN npm run build

FROM node:24-slim AS runtime

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/data ./data

ENV HOST=0.0.0.0
ENV REGION_DATA_DIR=/app/server/data
ENV RAID_DB_PATH=/data/walkwar.sqlite
EXPOSE 3040

CMD ["node", "--experimental-sqlite", "dist/server/src/server.js"]
