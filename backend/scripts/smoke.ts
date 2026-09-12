/**
 * Read-only smoke check: connects with SIM_API (or SIM_KEY_OVERRIDE), lists the take/inpatient list and,
 * for each patient, what evidence already exists for the six discharge jobs.
 */
import { SIM_API } from '../src/config.js'
import { SimClient } from '../src/sim/client.js'

const key = process.env.SIM_KEY_OVERRIDE ?? SIM_API
const sim = new SimClient(key, 'smoke')

const team = await sim.team()
const clock = await sim.clock()
console.log(`team=${team.team} world=${team.world} scopes=${team.scopes.join(',')}`)
console.log(`sim now=${new Date(clock.now).toISOString()} paused=${clock.paused} speed=${clock.speed}`)

const att = await sim.attendances()
const active = att.resources.filter((a) => a.data.stage === 'inpatient' || a.data.stage === 'take')
console.log(`\n${att.resources.length} attendances, ${active.length} on the take/inpatient list\n`)

const [pharmacy, gpDocs, hospDocs] = await Promise.all([sim.pharmacyWorkspace(), sim.gpDocuments(), sim.hospitalDocuments()])

for (const a of active) {
  const p = att.patients.find((x) => x.id === a.patientId)
  const [hosp, community, diagnostics] = await Promise.all([
    sim.view('hospital', a.patientId),
    sim.view('community', a.patientId),
    sim.view('diagnostics', a.patientId),
  ])
  const pid = a.patientId
  const letters = hospDocs.resources.filter((r) => r.patientId === pid && r.kind === 'discharge-summary')
  const gpLetters = gpDocs.resources.filter((r) => r.patientId === pid)
  const rx = pharmacy.resources.filter((r) => r.patientId === pid && r.kind === 'prescription')
  const tests = diagnostics.resources.filter((r) => r.patientId === pid && r.kind === 'test')
  const visits = community.resources.filter((r) => r.patientId === pid && (r.kind === 'visit' || r.kind === 'care-plan' || r.kind === 'care-package'))
  const referrals = community.resources.filter((r) => r.patientId === pid && r.kind === 'referral')
  const beds = hosp.resources.filter((r) => r.patientId === pid && r.kind === 'bed')
  const s = (rs: { status: string }[]) => (rs.length ? rs.map((r) => r.status).join('/') : '—')
  console.log(`${pid} ${p?.name ?? '?'} · ${a.data.presentingComplaint} · ${a.data.stage} @ ${a.data.location} · conditions=${p?.conditions.join(', ')} · needs=${p?.needs.join(', ')}`)
  if (beds.length) console.log(`   bed: ${beds.map((b) => `${b.title} barrier=${(b.data as any).barrier}`).join('; ')}`)
  console.log(`   letter=${s(letters)}  gp-inbox=${s(gpLetters)}  tto=${s(rx)}  labs=${s(tests)}  community=${s(visits)}  equipment/referrals=${s(referrals)}`)
}
