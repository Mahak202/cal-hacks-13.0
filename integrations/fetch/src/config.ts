import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ASI1_BASE_URL, ASI1_DEFAULT_MODEL } from './asi1'
import { CLAUDE_DEFAULT_MODEL } from './claude'

export const INTEGRATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Loads integrations/fetch/.env (or ROOMWISE_FETCH_ENV_FILE). Values already
// in the environment win, matching Node's loadEnvFile behaviour.
export function loadEnvFile(file = process.env.ROOMWISE_FETCH_ENV_FILE ?? path.join(INTEGRATION_ROOT, '.env')): boolean {
  if (!fs.existsSync(file)) return false
  process.loadEnvFile(file)
  return true
}

export type InterpreterConfig =
  | { provider: 'asi1'; apiKey: string; model: string; baseUrl: string }
  | { provider: 'claude'; apiKey: string; model: string }
  | { provider: 'keyword' }

export type ServiceConfig = {
  host: string
  port: number
  apiKey: string
  interpreter: InterpreterConfig
  liveSearchConfigured: boolean
  sessionTtlMs: number
  maxSessions: number
  searchTimeoutMs: number
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, problems: string[]): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) problems.push(`${name} must be a positive whole number.`)
  return n
}

// ROOMWISE_LLM_PROVIDER: auto (default) | asi1 | claude | keyword.
// auto prefers ASI:One, then Claude, then the keyword interpreter.
function interpreterConfig(env: NodeJS.ProcessEnv, problems: string[]): InterpreterConfig {
  const provider = (env.ROOMWISE_LLM_PROVIDER || 'auto').toLowerCase()
  const asi1 = (): InterpreterConfig => ({ provider: 'asi1', apiKey: env.ASI1_API_KEY!, model: env.ASI1_MODEL || ASI1_DEFAULT_MODEL, baseUrl: env.ASI1_BASE_URL || ASI1_BASE_URL })
  const claude = (): InterpreterConfig => ({ provider: 'claude', apiKey: env.ANTHROPIC_API_KEY!, model: env.ROOMWISE_LLM_MODEL || CLAUDE_DEFAULT_MODEL })
  switch (provider) {
    case 'auto':
      return env.ASI1_API_KEY ? asi1() : env.ANTHROPIC_API_KEY ? claude() : { provider: 'keyword' }
    case 'asi1':
      if (!env.ASI1_API_KEY) problems.push('ROOMWISE_LLM_PROVIDER=asi1 needs ASI1_API_KEY.')
      return asi1()
    case 'claude':
      if (!env.ANTHROPIC_API_KEY) problems.push('ROOMWISE_LLM_PROVIDER=claude needs ANTHROPIC_API_KEY.')
      return claude()
    case 'keyword':
      return { provider: 'keyword' }
    default:
      problems.push('ROOMWISE_LLM_PROVIDER must be auto, asi1, claude or keyword.')
      return { provider: 'keyword' }
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const problems: string[] = []
  const apiKey = env.ROOMWISE_PLANNER_API_KEY ?? ''
  if (apiKey.length < 24) problems.push('ROOMWISE_PLANNER_API_KEY must be set to a random secret of at least 24 characters.')
  const config: ServiceConfig = {
    host: env.ROOMWISE_PLANNER_HOST || '127.0.0.1',
    port: positiveInt(env, 'ROOMWISE_PLANNER_PORT', 8787, problems),
    apiKey,
    interpreter: interpreterConfig(env, problems),
    liveSearchConfigured: !!env.APIFY_TOKEN,
    sessionTtlMs: positiveInt(env, 'ROOMWISE_SESSION_TTL_MINUTES', 120, problems) * 60_000,
    maxSessions: positiveInt(env, 'ROOMWISE_MAX_SESSIONS', 1000, problems),
    searchTimeoutMs: positiveInt(env, 'ROOMWISE_SEARCH_TIMEOUT_SECONDS', 90, problems) * 1000,
  }
  if (problems.length) throw new Error(`Invalid planner configuration:\n- ${problems.join('\n- ')}`)
  return config
}
