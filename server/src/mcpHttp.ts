import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { APP_SERVER, appToolDefs, type UserSaid } from './appTools.js';
import type { GuardContext } from './guard.js';

/**
 * Servidor MCP do app por HTTP, para os providers que rodam fora deste processo (Codex, Kimi).
 * Cada conversa (música + dia) ganha uma URL com um token aleatório que identifica a pasta
 * da música; as ferramentas são as mesmas do Claude, mais escrever/editar arquivo (as
 * ferramentas nativas de gravação desses providers ficam desligadas). Só escuta em 127.0.0.1.
 */
interface Binding {
  ctx: GuardContext;
  date: string;
  said: UserSaid;
}

const bindings = new Map<string, Binding>();
const byKey = new Map<string, string>();
let baseUrl = '';

/** Token estável por música+dia enquanto o servidor estiver no ar (os providers guardam a URL na config da sessão). */
export function mcpUrlFor(key: string, binding: Binding): string {
  let token = byKey.get(key);
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    byKey.set(key, token);
  }
  bindings.set(token, binding); // atualiza (ex.: mensagens recentes do usuário)
  return `${baseUrl}/mcp/${token}`;
}

export function registerMcpRoutes(app: FastifyInstance, port: number) {
  baseUrl = `http://127.0.0.1:${port}`;

  app.post<{ Params: { token: string } }>('/mcp/:token', async (req, reply) => {
    const b = bindings.get(req.params.token);
    if (!b) return reply.code(404).send({ error: 'Sessão MCP desconhecida' });

    // modo sem estado: um servidor por requisição (as ferramentas são baratas de montar)
    const server = new McpServer({ name: APP_SERVER, version: '1.0.0' });
    for (const def of appToolDefs(b.ctx, b.date, b.said, { fileTools: true })) {
      server.registerTool(def.name, { description: def.description, inputSchema: def.inputSchema }, (args: unknown, extra: unknown) =>
        def.handler(args as never, extra),
      );
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // sem sessão no servidor: GET (stream de notificações) e DELETE não se aplicam
  const notAllowed = { jsonrpc: '2.0', error: { code: -32000, message: 'Método não permitido.' }, id: null };
  app.get('/mcp/:token', async (_req, reply) => reply.code(405).send(notAllowed));
  app.delete('/mcp/:token', async (_req, reply) => reply.code(405).send(notAllowed));
}
