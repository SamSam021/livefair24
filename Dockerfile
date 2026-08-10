FROM node:22-alpine

WORKDIR /app

# Install backend dependencies first (better layer caching)
COPY backend/package.json ./backend/package.json
RUN cd backend && npm install --omit=dev

# Copy the rest of the app — backend code + the static site it serves
COPY backend ./backend
COPY fairlive-site ./fairlive-site

ENV PORT=8080
EXPOSE 8080

CMD ["node", "backend/server.js"]
