FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY templates ./templates
COPY static ./static
RUN chown -R app:app /app
USER app
EXPOSE 8080
CMD ["node", "src/server.js"]
