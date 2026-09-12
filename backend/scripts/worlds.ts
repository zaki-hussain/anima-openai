/**
 * Mint the two demo worlds (baseline = "today's ward", agent = "with DischargeFlow") and write .worlds.json.
 * Usage: npm run worlds:create [-- <suffix>]   (default suffix: yymmdd-hhmm). Re-running with the same suffix re-joins.
 */
import { writeFileSync } from 'node:fs'
import { WORLDS_PATH } from '../src/config.js'
import { createWorld } from '../src/sim/client.js'

const now = new Date()
const suffix = process.argv[2] ?? `${now.toISOString().slice(2, 10).replace(/-/g, '')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
const names = { baseline: `dischargeflow-baseline-${suffix}`, agent: `dischargeflow-agent-${suffix}` }
console.log(`Creating worlds ${names.baseline} and ${names.agent} (first creation takes ~1–2 min each, running in parallel)…`)
const t0 = Date.now()
const [baseline, agent] = await Promise.all([createWorld(names.baseline), createWorld(names.agent)])
const file = {
  suffix,
  createdAt: now.toISOString(),
  baseline: { teamName: names.baseline, apiKey: baseline.apiKey, world: baseline.world },
  agent: { teamName: names.agent, apiKey: agent.apiKey, world: agent.world },
}
writeFileSync(WORLDS_PATH, JSON.stringify(file, null, 2))
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s → ${WORLDS_PATH}`)
console.log(`baseline world=${baseline.world} created=${baseline.created}; agent world=${agent.world} created=${agent.created}`)
