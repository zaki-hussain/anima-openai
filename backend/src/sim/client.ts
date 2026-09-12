import { SIM_ORIGIN } from '../config.js'
import type { Attendance, SimAction, SimClock, SimPatient, SimResource, SimTeam, SimView, SimWorkspace, Site } from './types.js'

export class SimError extends Error {
  constructor(public status: number, public body: unknown, public path: string) {
    super(`Sim ${status} on ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
}

/** Tiny semaphore: sim writes take ~15–20 s each and only partly parallelise; cap them per world. */
class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

export interface WorldKey { apiKey: string; team: string; world: string; scopes: string[]; created: boolean }

/** Create or join an isolated world by name (public endpoint). First creation takes ~1–2 minutes. */
export async function createWorld(teamName: string, origin = SIM_ORIGIN): Promise<WorldKey> {
  const res = await fetch(`${origin}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamName }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new SimError(res.status, body, '/api/keys')
  return body as WorldKey
}

export class SimClient {
  private readonly writes: Semaphore
  constructor(
    private readonly key: string,
    readonly label = 'world',
    private readonly origin = SIM_ORIGIN,
    maxConcurrentWrites = 4,
  ) {
    if (!key) throw new Error(`SimClient(${label}): missing key`)
    this.writes = new Semaphore(maxConcurrentWrites)
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra }
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.origin}${path}`, { headers: this.headers() })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new SimError(res.status, body, path)
    return body as T
  }

  /**
   * POST with retries on transport errors and 5xx (the sim returns occasional 502s under concurrent writes).
   * Safe because every action carries an Idempotency-Key: an identical retry returns the original result.
   */
  private async post<T>(path: string, body: unknown, extra: Record<string, string> = {}, attempts = 4): Promise<T> {
    let lastErr: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(`${this.origin}${path}`, { method: 'POST', headers: this.headers(extra), body: JSON.stringify(body) })
        const out = await res.json().catch(() => null)
        if (res.ok) return out as T
        const err = new SimError(res.status, out, path)
        if (res.status < 500) throw err
        lastErr = err
      } catch (err) {
        if (err instanceof SimError && err.status < 500) throw err
        lastErr = err
      }
      await new Promise((r) => setTimeout(r, 3000 * 2 ** i))
    }
    throw lastErr
  }

  // ---- reads (fast, ~1 s) ----
  team() { return this.get<SimTeam>('/api/team') }
  clock() { return this.get<SimClock>('/api/clock') }
  attendances() { return this.get<Omit<SimWorkspace, 'resources'> & { resources: Attendance[] }>('/api/sites/hospital/attendances') }
  hospitalDocuments() { return this.get<SimWorkspace>('/api/sites/hospital/documents') }
  gpDocuments() { return this.get<SimWorkspace>('/api/sites/gp/documents') }
  pharmacyWorkspace() { return this.get<SimWorkspace>('/api/sites/pharmacy/pharmacy-workspace') }
  patients(site: Site, q: string, offset = 0) {
    return this.get<{ items: SimPatient[]; total: number }>(`/api/sites/${site}/patients?q=${encodeURIComponent(q)}&offset=${offset}`)
  }
  /** Site view. Always pass a patient for `gp` — the unfiltered GP view is enormous. */
  view(site: Site, patientId?: string, opts: { offset?: number; limit?: number } = {}) {
    if (site === 'gp' && !patientId) throw new Error('Refusing to read the unfiltered GP view (374k resources); pass a patientId')
    const q = new URLSearchParams()
    if (patientId) q.set('patient', patientId)
    if (opts.offset) q.set('offset', String(opts.offset))
    if (opts.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    return this.get<SimView>(`/api/sites/${site}/view${qs ? `?${qs}` : ''}`)
  }

  // ---- writes (slow, ~15–20 s) ----
  /** Pause and advance the world clock; executes due jobs (lab results, visits, deliveries). ~22 s. */
  advance(minutes: number) {
    return this.writes.run(() => this.post<SimClock>('/api/clock', { paused: true, advanceMinutes: minutes }))
  }

  /**
   * Submit a typed action. `idem` must be stable per logical action (reuse to retry the identical request).
   * On a 409 with a resourceId we re-read the resource once and retry with the fresh version.
   */
  async action<T = SimResource>(site: Site, body: SimAction, idem: string): Promise<T> {
    return this.writes.run(async () => {
      try {
        return await this.post<T>(`/api/sites/${site}/actions`, body, { 'Idempotency-Key': idem })
      } catch (err) {
        if (err instanceof SimError && err.status === 409 && body.resourceId && body.expectedVersion !== undefined) {
          const fresh = await this.findResource(site, body.resourceId, body.patientId)
          if (fresh && fresh.version !== body.expectedVersion) {
            return await this.post<T>(`/api/sites/${site}/actions`, { ...body, expectedVersion: fresh.version }, { 'Idempotency-Key': `${idem}:v${fresh.version}` })
          }
        }
        throw err
      }
    })
  }

  /** Locate a resource's current state (for version refresh). */
  async findResource(site: Site, resourceId: string, patientId?: string): Promise<SimResource | undefined> {
    if (site === 'pharmacy') return (await this.pharmacyWorkspace()).resources.find((r) => r.id === resourceId)
    if (site === 'hospital' && resourceId.startsWith('hospital-attendance')) return (await this.attendances()).resources.find((r) => r.id === resourceId)
    if (site === 'gp' && !patientId) return (await this.gpDocuments()).resources.find((r) => r.id === resourceId)
    return (await this.view(site, patientId)).resources.find((r) => r.id === resourceId)
  }
}

/** Idempotency key convention: world:patient:workstream:step */
export const idem = (world: string, patientId: string, workstream: string, step: string) => `${world}:${patientId}:${workstream}:${step}`
