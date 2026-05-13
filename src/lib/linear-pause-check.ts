import type { Config } from './config.js';
import { LINEAR_PAUSE_LABEL } from './kill-switch.js';

const LINEAR_GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql';
// Excludes both `completed` (Done) and `canceled` — a stale canceled
// issue with the pause label should not halt the orchestrator. Codex
// v0.2-R1 [P2] fix.
const LINEAR_QUERY = `
  query CheckOrchestratorPaused($teamKey: String!, $label: String!) {
    issues(
      filter: {
        team: { key: { eq: $teamKey } }
        state: { type: { nin: ["completed", "canceled"] } }
        labels: { name: { eq: $label } }
      }
      first: 1
    ) {
      nodes { id }
    }
  }
`;

// Bound the optional API call. Node 22's fetch (Undici) defaults to a
// 300s body timeout — long enough to hang a CLI invocation or block a
// reusable workflow's resolver step. Treat any response slower than this
// as "no-op" so the other kill-switch paths remain effective. Codex
// v0.2-R1 [P2] fix.
const DEFAULT_TIMEOUT_MS = 5_000;

export interface LinearPauseCheckerOptions {
  apiKey: string;
  teamKey: string;
  label?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createLinearPauseChecker(
  opts: LinearPauseCheckerOptions,
): () => Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const label = opts.label ?? LINEAR_PAUSE_LABEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(LINEAR_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: opts.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: LINEAR_QUERY,
          variables: { teamKey: opts.teamKey, label },
        }),
        signal: controller.signal,
      });
      if (!res.ok) return false;
      const json = (await res.json()) as {
        data?: { issues?: { nodes?: Array<{ id: string }> } };
        errors?: unknown;
      };
      if (json.errors) return false;
      return (json.data?.issues?.nodes?.length ?? 0) > 0;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function maybeCreateLinearPauseChecker(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): (() => Promise<boolean>) | undefined {
  const apiKey = env.LINEAR_API_KEY;
  if (!apiKey || !config.linear_team) return undefined;
  return createLinearPauseChecker({ apiKey, teamKey: config.linear_team });
}
