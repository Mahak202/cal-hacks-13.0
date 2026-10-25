import crypto from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { pathToFileURL } from 'node:url'
import { handleChat, type ChatDeps } from './chat'
import { asi1Client, asi1Interpreter } from './asi1'
import { anthropicClient, claudeInterpreter } from './claude'
import { loadEnvFile, readConfig, type InterpreterConfig } from './config'
import { apifyShoppingSearch, SearchCache } from './liveSearch'
import type { Interpreter } from './prompt'
import { SPECIALISTS, TOOL_OWNER, type Specialist } from './roles'
import { ROLE_TOOL_SPECS } from './tools'
import { SessionStore } from './sessions'
import { appendHistory, conversationState, executeAsAgent, handleRoleChat, interpretForTeam, RoleError } from './team'

// HTTP API called only by the Roomwise uAgents (agent/). They pass the end
// user's sender address and ACP session id taken from verified message
// envelopes; this service trusts them only because the caller holds the
// shared API key.

const MAX_BODY_BYTES = 64 * 1024
export const MAX_MESSAGE_CHARS = 4000
const SENDER_RE = /^[A-Za-z0-9:._-]{1,256}$/
const SESSION_RE = /^[A-Za-z0-9._-]{1,128}$/

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  // Drain (and discard) oversized bodies so the client receives the 413
  // instead of a reset connection.
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size <= MAX_BODY_BYTES) chunks.push(chunk as Buffer)
  }
  if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large.')
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'Body must be valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, 'Body must be a JSON object.')
  return parsed as Record<string, unknown>
}

function authorized(req: IncomingMessage, apiKey: string): boolean {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = crypto.createHash('sha256').update(token).digest()
  const b = crypto.createHash('sha256').update(apiKey).digest()
  return token.length > 0 && crypto.timingSafeEqual(a, b)
}

function identity(body: Record<string, unknown>): { sender: string; sessionId: string } {
  const { sender, session_id: sessionId } = body
  if (typeof sender !== 'string' || !SENDER_RE.test(sender)) throw new HttpError(400, 'sender must be an agent address (letters, digits, : . _ -).')
  if (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId)) throw new HttpError(400, 'session_id must be 1-128 characters (letters, digits, . _ -).')
  return { sender, sessionId }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`)
  const trimmed = value.trim()
  if (!trimmed) throw new HttpError(400, `${field} must not be empty.`)
  if (trimmed.length > MAX_MESSAGE_CHARS) throw new HttpError(400, `${field} must be at most ${MAX_MESSAGE_CHARS} characters.`)
  return trimmed
}

const POST_ROUTES = new Set(['/v1/chat', '/v1/sessions/end', '/v1/agent/execute', '/v1/agent/interpret', '/v1/agent/state', '/v1/agent/history', '/v1/agent/chat'])

export type PlannerServerOptions = { apiKey: string; status?: () => Record<string, unknown> }

export function createPlannerServer(deps: ChatDeps, options: PlannerServerOptions): http.Server {
  return http.createServer(async (req, res) => {
    const url = (req.url ?? '').split('?')[0]
    try {
      if (req.method === 'GET' && url === '/healthz') return send(res, 200, { ok: true })
      if (!authorized(req, options.apiKey)) throw new HttpError(401, 'Unauthorized.')
      if (req.method === 'GET' && url === '/v1/status') return send(res, 200, { ok: true, sessions: deps.sessions.size, ...options.status?.() })
      if (req.method === 'GET' && url === '/v1/agent/tools') return send(res, 200, { tools: ROLE_TOOL_SPECS.map((spec) => ({ ...spec, agent: TOOL_OWNER[spec.name] })) })
      if (req.method !== 'POST' || !POST_ROUTES.has(url)) throw new HttpError(404, 'Not found.')
      const body = await readJson(req)
      const who = identity(body)
      switch (url) {
        case '/v1/chat':
          return send(res, 200, await handleChat(deps, { ...who, message: text(body.message, 'message') }))
        case '/v1/sessions/end':
          return send(res, 200, { ended: deps.sessions.end(who.sender, who.sessionId) })
        // Agent team (see src/team.ts and agent/).
        case '/v1/agent/execute':
          if (typeof body.tool !== 'string') throw new HttpError(400, 'tool must be text.')
          return send(res, 200, await executeAsAgent(deps, who, body.agent, { name: body.tool, input: body.arguments ?? {} }))
        case '/v1/agent/interpret':
          return send(res, 200, await interpretForTeam(deps, who, text(body.message, 'message')))
        case '/v1/agent/state':
          return send(res, 200, await conversationState(deps, who))
        case '/v1/agent/history':
          return send(res, 200, await appendHistory(deps, who, text(body.user, 'user'), text(body.assistant, 'assistant')))
        case '/v1/agent/chat': {
          const role = body.agent
          if (!SPECIALISTS.includes(role as Specialist)) throw new HttpError(400, `agent must be one of: ${SPECIALISTS.join(', ')}.`)
          return send(res, 200, await handleRoleChat(deps, who, role as Specialist, text(body.message, 'message')))
        }
      }
      throw new HttpError(404, 'Not found.')
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message })
      if (err instanceof RoleError) return send(res, 403, { error: err.message })
      deps.log?.(`Unhandled error on ${req.method} ${url}`, err)
      return send(res, 500, { error: 'Internal error.' })
    }
  })
}

function buildInterpreter(config: InterpreterConfig): Interpreter | undefined {
  if (config.provider === 'asi1') return asi1Interpreter(asi1Client(config.apiKey, config.baseUrl), config.model)
  if (config.provider === 'claude') return claudeInterpreter(anthropicClient(config.apiKey), config.model)
  return undefined
}

async function main() {
  const loaded = loadEnvFile()
  const config = readConfig()
  const log = (message: string, err?: unknown) => console.error(`[roomwise-planner] ${message}`, err ?? '')
  const deps: ChatDeps = {
    engine: { search: apifyShoppingSearch, cache: new SearchCache(), timeoutMs: config.searchTimeoutMs, maxResults: 8, searchConcurrency: 3, now: () => new Date() },
    sessions: new SessionStore({ ttlMs: config.sessionTtlMs, maxSessions: config.maxSessions }),
    interpreter: buildInterpreter(config.interpreter),
    log,
  }
  const i = config.interpreter
  const status = () => ({ liveSearchConfigured: config.liveSearchConfigured, interpreter: i.provider === 'keyword' ? 'keyword' : `${i.provider} (${i.model})` })
  const server = createPlannerServer(deps, { apiKey: config.apiKey, status })
  server.listen(config.port, config.host, () => {
    console.log(`[roomwise-planner] listening on http://${config.host}:${config.port} (env file ${loaded ? 'loaded' : 'not found'})`)
    console.log(`[roomwise-planner] live search ${config.liveSearchConfigured ? 'configured' : 'NOT configured: every search will be reported as failed'}; interpreter: ${status().interpreter}`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
