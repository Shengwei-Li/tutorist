import { execText, which } from '@tutordesk/core';
import { AcpSession, OPENCODE_ACP } from './acp.js';
import { ClaudeCodeSession } from './claude.js';
import { CodexSession } from './codex.js';
import type { CliHarnessId, HarnessHealth, HarnessId, HarnessSession, McpLaunch, SessionStart } from './types.js';

export const HARNESSES: { id: CliHarnessId; label: string; program: string; login: string }[] = [
  { id: 'claude-code', label: 'Claude Code', program: 'claude', login: 'claude auth login' },
  { id: 'codex', label: 'Codex', program: 'codex', login: 'codex login' },
  { id: 'opencode', label: 'OpenCode', program: 'opencode', login: 'opencode auth login' },
];

export function createSession(harness: CliHarnessId, opts: SessionStart): HarnessSession {
  switch (harness) {
    case 'claude-code':
      return new ClaudeCodeSession(opts);
    case 'codex':
      return new CodexSession(opts);
    case 'opencode':
      return new AcpSession(opts, OPENCODE_ACP);
  }
}

/** Installed? Which version? Signed in? Without starting a session or spending anything. */
export async function checkHarness(harness: CliHarnessId, env: NodeJS.ProcessEnv = process.env): Promise<HarnessHealth> {
  const h = HARNESSES.find((x) => x.id === harness)!;
  const exe = await which(h.program, env);
  if (!exe) return { harness, installed: false, detail: `${h.label} is not installed.` };
  const ver = await execText(exe, ['--version'], { env, timeoutMs: 20_000 });
  const version = /\d+\.\d+\.\d+/.exec(ver.stdout)?.[0];
  const base = { harness, installed: ver.code === 0, version, executable: exe.prefixArgs[0] ?? exe.command };
  switch (harness) {
    case 'claude-code': {
      const st = await execText(exe, ['auth', 'status'], { env, timeoutMs: 20_000 });
      let authed = false;
      try {
        authed = (JSON.parse(st.stdout) as { loggedIn?: boolean }).loggedIn === true;
      } catch {
        /* unknown output */
      }
      return { ...base, authed, detail: authed ? undefined : `Sign in to Claude Code: run \`${h.login}\`.` };
    }
    case 'codex': {
      const st = await execText(exe, ['login', 'status'], { env, timeoutMs: 20_000 });
      const authed = st.code === 0 && /logged in/i.test(st.stdout + st.stderr);
      return { ...base, authed, detail: authed ? undefined : `Sign in to Codex: run \`${h.login}\`.` };
    }
    case 'opencode':
      // OpenCode reports its providers only once a session starts (ACP authMethods).
      return { ...base, authed: undefined };
  }
}

/**
 * How an agent starts the tutordesk MCP server. Inside Electron the app's own binary runs it as plain
 * Node (ELECTRON_RUN_AS_NODE), so tutors need no separate Node install.
 */
export function tutordeskMcpLaunch(o: {
  serverScript: string;
  workspace: string;
  by: HarnessId;
  runtime?: string;
  electron?: boolean;
  requirePlanApproval?: boolean;
  /** TeX binaries folder. Passed by the app only, never read from the workspace, which agents can write. */
  texBin?: string;
  /** The app's bundled Tectonic and its offline cache (same rule: from the app, never the workspace). */
  tectonic?: { binary: string; cacheDir: string };
  preferBundled?: boolean;
}): McpLaunch {
  return {
    command: o.runtime ?? process.execPath,
    args: [
      o.serverScript,
      '--workspace',
      o.workspace,
      '--by',
      o.by,
      ...(o.requirePlanApproval === false ? ['--require-plan-approval', 'false'] : []),
      ...(o.texBin ? ['--tex-bin', o.texBin] : []),
      ...(o.tectonic ? ['--tectonic', o.tectonic.binary, '--tectonic-cache', o.tectonic.cacheDir] : []),
      ...(o.preferBundled ? ['--tex-engine', 'bundled'] : []),
    ],
    env: o.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  };
}
