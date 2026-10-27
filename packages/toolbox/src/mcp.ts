import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Toolbox } from './toolbox.js';

export const SERVER_INSTRUCTIONS = `TutorDesk teaching tools for a private English tutor's workspace (IELTS and PTE).
- Read get_student_context before planning, writing or reviewing for a student.
- Lesson documents and essay reviews are saved only through save_* tools, which check the format, the content rules and the typesetting and tell you exactly what to fix. Keep fixing and saving until a document passes.
- The tutor approves plan cards, sets final bands and decides what enters the error log. You propose; never claim something is approved or final.
- Exam facts come from get_guidelines ("ielts" or "pte"), never from memory.`;

/** Expose the toolbox over MCP (appendix E.4). Every harness mounts the same server. */
export function createMcpServer(box: Toolbox, version = '0.1.0'): McpServer {
  const server = new McpServer({ name: 'tutordesk', version }, { instructions: SERVER_INSTRUCTIONS });
  for (const def of box.definitions()) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: { title: def.title, readOnlyHint: def.readOnly, destructiveHint: false, idempotentHint: def.readOnly, openWorldHint: false },
      },
      // The SDK has validated against the shape already; Toolbox.call validates again and never throws.
      (async (args: unknown) => {
        const r = await box.call(def.name, args);
        return { content: [{ type: 'text' as const, text: r.text }], isError: r.isError };
      }) as never,
    );
  }
  return server;
}
