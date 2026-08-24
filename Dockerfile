# B.L.A.Y.N.E — production container for Cloud Run (or any Node host).
#
# Two stages: the builder compiles the React front end, the runtime image
# only carries the built output plus the API server and production deps.
#
# The two VITE_ build args are NOT secrets (see .env.example — they're safe
# to expose, RLS protects the data, not the key) but Vite bakes them into the
# static JS bundle at BUILD time, not runtime, so they must arrive as
# --build-arg here rather than as a Cloud Run runtime env var — a runtime-only
# env var would never reach the bundle and the deployed site would throw
# "Missing VITE_SUPABASE_URL" in the browser.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=builder /app/dist ./dist

# Cloud Run injects PORT at runtime (usually 8080); server/index.js already
# reads process.env.PORT, so this is documentation, not a hard requirement.
EXPOSE 8080

CMD ["node", "--env-file-if-exists=.env", "server/index.js"]
