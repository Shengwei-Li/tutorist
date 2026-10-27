import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WorkspaceService } from '@tutordesk/core';
import { TexEngine } from '@tutordesk/tex';
import { writeAgentKit } from './kit.js';
import { createMcpServer } from './mcp.js';
import { Toolbox } from './toolbox.js';

/**
 * `tutordesk-mcp --workspace <root>`: the stdio MCP server agents mount (appendix E.4.3).
 * Studio name and tutor name come from <root>/.tutordesk/toolbox.json, which TutorDesk writes.
 * stdout carries the protocol, so diagnostics go to stderr only.
 */
async function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: 'string' },
      by: { type: 'string' },
      'require-plan-approval': { type: 'string', default: 'true' },
      'tex-bin': { type: 'string' },
      'write-kit': { type: 'boolean', default: false },
    },
  });
  if (!values.workspace) {
    process.stderr.write('usage: tutordesk-mcp --workspace <root> [--write-kit] [--by <harness>] [--require-plan-approval true|false] [--tex-bin <dir>]\n');
    process.exit(2);
  }
  const root = path.resolve(values.workspace);
  if (values['write-kit']) {
    for (const f of await writeAgentKit(root)) process.stderr.write(`wrote ${f}
`);
    return;
  }
  const cfg = JSON.parse(await readFile(path.join(root, '.tutordesk', 'toolbox.json'), 'utf8').catch(() => '{}')) as {
    studio?: { name: string; monogram?: string };
    tutorName?: string;
  };
  const studio = cfg.studio ?? { name: 'Private Tutoring' };
  const box = new Toolbox({
    ws: new WorkspaceService(root),
    tex: new TexEngine({ binDir: values['tex-bin'], maxConcurrent: 1 }),
    templateDir: path.join(root, 'templates', 'tex'),
    studio,
    tutorName: cfg.tutorName || studio.name,
    requirePlanApproval: values['require-plan-approval'] !== 'false',
    by: values.by,
  });
  await createMcpServer(box).connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(`tutordesk-mcp: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
