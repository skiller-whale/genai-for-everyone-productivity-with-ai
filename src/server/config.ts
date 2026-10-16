import { resolve } from 'node:path';

// Everything the server reads from its environment, in one place.

/** Where this process sees the shared workspace (the volume both containers mount). */
export const WORKSPACE_DIR = resolve(process.env.WORKSPACE_DIR ?? './workspace-data');
/** Where the sandbox container sees the same folder. */
export const SANDBOX_WORKSPACE = '/workspace';
export const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER ?? 'cowork-sandbox';
export const SCENARIOS_DIR = resolve(process.env.SCENARIOS_DIR ?? './scenarios');
export const PORT = Number(process.env.PORT ?? 3000);

/** The sandbox's user. Files the server writes are handed to it so Claude can edit them. */
export const SANDBOX_UID = 1000;

/**
 * Variables Claude Code needs inside the sandbox: one of the two ways to
 * authenticate (a token locally, the Bedrock proxy in the hosted environment)
 * and the model choice. Nothing else from the server's environment goes in.
 */
const FORWARDED = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'NODE_EXTRA_CA_CERTS',
];

export function claudeEnv(): Record<string, string> {
  const env: Record<string, string> = {
    // Already in a container: let Claude Code skip its own permission prompts.
    IS_SANDBOX: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'cowork-web/0.1',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
  for (const name of FORWARDED) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}
