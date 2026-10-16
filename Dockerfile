# The web app. It needs the docker CLI to run Claude Code in the sandbox.
FROM oven/bun:1.3.13
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json bun.lock ./
# Claude Code runs in the sandbox, so the SDK's own platform binary isn't needed here.
RUN bun install --frozen-lockfile --production --omit optional
COPY server.ts tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production PORT=3000 WORKSPACE_DIR=/workspace
EXPOSE 3000
CMD ["bun", "server.ts"]
