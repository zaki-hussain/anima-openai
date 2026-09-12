export type Site = 'gp' | 'hospital' | 'community' | 'pharmacy' | 'diagnostics' | 'referrals' | 'wearables' | 'patient'

export interface SimActor { kind: 'team' | 'simulation'; name: string }

export interface SimResource<D = Record<string, unknown>> {
  id: string
  kind: string
  title: string
  status: string
  owner: string
  visibleTo: string[]
  patientId?: string
  priority?: string
  createdAt: number
  dueAt?: number
  version: number
  data: D
  provenance?: { created: { actor: SimActor; source: string; action: string; time: number; version: number }; changes: unknown[] }
}

export interface SimPatient {
  id: string
  name: string
  birthDate: string
  localIds: Record<string, string>
  conditions: string[]
  needs: string[]
  goals: string[]
  synthetic: true
}

export interface SimClock {
  now: number
  paused: boolean
  speed: number
  events: SimEvent[]
}

export interface SimEvent {
  id: string
  time: number
  type: string
  actor: string
  detail: string
  resourceId?: string
  patientId?: string
  visibleTo: string[]
}

export interface SimView {
  id: string
  now: number
  speed: number
  paused: boolean
  population: number
  counters: Record<string, number>
  resources: SimResource[]
  resourceTotal: number
  resourceOffset: number
  resourceLimit: number
  staffing: Record<string, number>
  faults: Record<string, unknown>
  events: SimEvent[]
}

export interface SimWorkspace {
  resources: SimResource[]
  patients: SimPatient[]
  now: number
}

export interface SimTeam { team: string; world: string; scopes: string[] }

export interface AttendanceData {
  stage: 'waiting' | 'assessing' | 'take' | 'inpatient' | 'discharged'
  acuity: string
  location: string
  arrivalAt: number
  clinician: string
  presentingComplaint: string
  assessmentAt?: number
  referredAt?: number
  admittedAt?: number
  dischargedAt?: number
  disposition?: string
  [key: string]: unknown
}

export type Attendance = SimResource<AttendanceData>

export type HospitalCommand = 'assign' | 'assess' | 'refer' | 'admit' | 'discharge'
export type DocumentCommand = 'send' | 'assign' | 'review' | 'file' | 'annotate'

export interface DischargeSections {
  reason: string
  course: string
  diagnoses: string
  medicationChanges: string
  results: string
  followUp: string
  gpActions: string
}

export interface MedicationOrder {
  drug: string
  dose: string
  unit: string
  route: string
  frequency: string
  duration: string
  quantity: number
  indication: string
}

export interface BloodTestOrder {
  panel: string
  panelId: 'fbc' | 'ue' | 'hba1c' | 'lft' | 'crp' | 'lipids'
  specimen: string
  priority: 'routine' | 'urgent'
  collection: 'now' | 'next-round'
  clinicalDetails: string
}

/** The action envelope. Only the fields we use are typed; the sim validates the rest. */
export interface SimAction {
  type: string
  patientId?: string
  resourceId?: string
  expectedVersion?: number
  title?: string
  text?: string
  target?: Site | 'legacy'
  clinician?: string
  hospitalCommand?: HospitalCommand
  acuity?: string
  location?: string
  disposition?: string
  documentCommand?: DocumentCommand
  dischargeSections?: DischargeSections
  medicationOrder?: MedicationOrder
  bloodTestOrder?: BloodTestOrder
  productId?: string
  quantity?: number
  clientRequestId?: string
  [key: string]: unknown
}
