/**
 * Seed the identical inpatient cohort into both worlds in .worlds.json (or one world via SIM_KEY_OVERRIDE).
 * Idempotent: patients already inpatient are left alone; partial progress resumes from the current stage.
 * Cost: up to 4 writes per patient at ~15–20 s each, 4-way concurrent → ~3–4 min per world; worlds run in parallel.
 */
import { loadWorlds } from '../src/config.js'
import { SimClient, idem } from '../src/sim/client.js'
import type { Attendance } from '../src/sim/types.js'

export interface CohortPatient { id: string; complaint: string; acuity: string; bed: string }

/** Same 8 patients in every world. SIM-000001/005/006/007/008 have seeded attendances; 009–011 are registered fresh. */
export const COHORT: CohortPatient[] = [
  { id: 'SIM-000001', complaint: 'Breathlessness', acuity: '2', bed: 'AMU bed 4' },
  { id: 'SIM-000005', complaint: 'Dizziness', acuity: '3', bed: 'AMU bed 5' },
  { id: 'SIM-000006', complaint: 'Reduced mobility', acuity: '3', bed: 'AMU bed 1' },
  { id: 'SIM-000007', complaint: 'Chest discomfort', acuity: '2', bed: 'AMU bed 2' },
  { id: 'SIM-000008', complaint: 'Fall at home', acuity: '3', bed: 'AMU bed 3' },
  { id: 'SIM-000009', complaint: 'Community-acquired pneumonia', acuity: '3', bed: 'AMU bed 6' },
  { id: 'SIM-000010', complaint: 'Urinary tract infection with confusion', acuity: '3', bed: 'AMU bed 7' },
  { id: 'SIM-000011', complaint: 'Exacerbation of COPD', acuity: '3', bed: 'AMU bed 8' },
]

const CLINICIAN = 'Dr Alex Morgan'

export async function ensureInpatient(sim: SimClient, world: string, p: CohortPatient, log = console.log): Promise<Attendance> {
  const all = await sim.attendances()
  let att = all.resources
    .filter((a) => a.patientId === p.id && a.data.stage !== 'discharged')
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!att) {
    log(`  ${p.id}: register_attendance`)
    att = await sim.action<Attendance>('hospital', { type: 'register_attendance', patientId: p.id, title: p.complaint, acuity: p.acuity, location: 'Majors 3', clinician: CLINICIAN }, idem(world, p.id, 'seed', 'register'))
  }
  const step = async (hospitalCommand: 'assess' | 'refer' | 'admit', extra: Record<string, unknown>) => {
    log(`  ${p.id}: ${hospitalCommand} (v${att!.version})`)
    att = await sim.action<Attendance>('hospital', { type: 'update_attendance', resourceId: att!.id, expectedVersion: att!.version, hospitalCommand, ...extra }, idem(world, p.id, 'seed', hospitalCommand))
  }
  if (att.data.stage === 'waiting') await step('assess', { clinician: CLINICIAN })
  if (att.data.stage === 'assessing') await step('refer', {})
  if (att.data.stage === 'take') await step('admit', { location: p.bed })
  if (att.data.stage !== 'inpatient') throw new Error(`${p.id}: unexpected stage ${att.data.stage}`)
  return att
}

export async function seedWorld(label: string, apiKey: string, world: string) {
  const sim = new SimClient(apiKey, label)
  const t0 = Date.now()
  console.log(`[${label}] seeding ${COHORT.length} patients into ${world}`)
  const results = await Promise.all(COHORT.map((p) => ensureInpatient(sim, world, p, (m) => console.log(`[${label}]${m}`))))
  const clock = await sim.clock()
  console.log(`[${label}] done in ${Math.round((Date.now() - t0) / 1000)} s; fitAt=${clock.now}`)
  return { fitAt: clock.now, attendances: results.map((a) => ({ id: a.id, patientId: a.patientId, version: a.version, location: a.data.location })) }
}

if (process.env.SIM_KEY_OVERRIDE) {
  await seedWorld('override', process.env.SIM_KEY_OVERRIDE, 'override')
} else {
  const worlds = loadWorlds()
  if (!worlds) throw new Error('No .worlds.json — run `npm run worlds:create` first (or set SIM_KEY_OVERRIDE)')
  await Promise.all([
    seedWorld('baseline', worlds.baseline.apiKey, worlds.baseline.world),
    seedWorld('agent', worlds.agent.apiKey, worlds.agent.world),
  ])
}
