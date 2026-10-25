import type { SessionState } from './types'

export type SessionStoreOptions = { ttlMs?: number; maxSessions?: number; now?: () => number }

export function emptySession(sender: string, sessionId: string, now: number): SessionState {
  return {
    sender,
    sessionId,
    createdAt: now,
    updatedAt: now,
    preferences: { needs: [], demoOptIn: [] },
    searches: {},
    pinned: {},
    lastComparison: {},
    history: [],
  }
}

// In-memory conversation state keyed by the pair (verified sender address,
// ACP session id). Both values come from the uAgent's envelope, never from
// message text. Two senders reusing a session id, or one sender with two
// chats, get separate state. Work on one key is serialized so overlapping
// messages in a chat can't race; different keys run concurrently.
//
// Expiry: a session idle for longer than ttlMs is discarded on next access.
// When more than maxSessions are live, the least recently used is dropped.
// State does not survive a service restart.
export class SessionStore {
  private sessions = new Map<string, SessionState>()
  private locks = new Map<string, Promise<unknown>>()
  readonly ttlMs: number
  readonly maxSessions: number
  private now: () => number

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 2 * 60 * 60 * 1000
    this.maxSessions = options.maxSessions ?? 1000
    this.now = options.now ?? Date.now
  }

  static key(sender: string, sessionId: string): string {
    return JSON.stringify([sender, sessionId])
  }

  get size(): number {
    return this.sessions.size
  }

  peek(sender: string, sessionId: string): SessionState | undefined {
    return this.sessions.get(SessionStore.key(sender, sessionId))
  }

  end(sender: string, sessionId: string): boolean {
    return this.sessions.delete(SessionStore.key(sender, sessionId))
  }

  async withSession<T>(sender: string, sessionId: string, fn: (state: SessionState) => Promise<T>): Promise<T> {
    const key = SessionStore.key(sender, sessionId)
    const previous = this.locks.get(key) ?? Promise.resolve()
    const run = previous.then(() => fn(this.acquire(key, sender, sessionId)))
    const settled = run.then(
      () => {},
      () => {},
    )
    this.locks.set(key, settled)
    void settled.then(() => {
      if (this.locks.get(key) === settled) this.locks.delete(key)
    })
    return run
  }

  private acquire(key: string, sender: string, sessionId: string): SessionState {
    const now = this.now()
    for (const [k, s] of this.sessions) if (now - s.updatedAt > this.ttlMs) this.sessions.delete(k)
    const state = this.sessions.get(key) ?? emptySession(sender, sessionId, now)
    state.updatedAt = now
    // Re-insert so Map iteration order tracks recency.
    this.sessions.delete(key)
    this.sessions.set(key, state)
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined || oldest === key) break
      this.sessions.delete(oldest)
    }
    return state
  }
}
