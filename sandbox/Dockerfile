# The computer Claude works on: Claude Code itself plus the everyday tools for
# processing documents and data. It stays up; the app runs Claude Code in it
# with `docker exec` for each turn.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip git curl ca-certificates jq ripgrep poppler-utils \
 && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages pandas openpyxl matplotlib python-docx pypdf

# The Claude Code build that matches the app's Agent SDK version (0.3.296 ships Claude Code 2.1.296).
ARG SDK_VERSION=0.3.296
RUN arch="$(dpkg --print-architecture | sed 's/amd64/x64/')" \
 && mkdir -p /opt/claude && cd /opt/claude \
 && npm install --no-save --no-audit --no-fund "@anthropic-ai/claude-agent-sdk-linux-${arch}@${SDK_VERSION}" \
 && ln -s "/opt/claude/node_modules/@anthropic-ai/claude-agent-sdk-linux-${arch}/claude" /usr/local/bin/claude \
 && claude --version

# Claude works as the unprivileged `node` user (uid 1000), in /workspace.
RUN mkdir -p /workspace && chown node:node /workspace
USER node
ENV HOME=/home/node PIP_BREAK_SYSTEM_PACKAGES=1 PATH=/home/node/.local/bin:$PATH
WORKDIR /workspace
CMD ["sleep", "infinity"]
