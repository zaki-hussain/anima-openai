# DischargeFlow — build plan (Team 1, Sat 12 Sep 2026)

Written 14:55 BST. Submission closes **18:30 BST**. Demo stalls 18:30–19:30. Read `CLAUDE.md` first; API details in `docs/SIM_API.md`, ADK in `docs/ADK.md`.

## 0. Pitch (say this at the stall)

Every hospital has patients who are well enough to go home but cannot leave, because discharge is six jobs for six teams — pharmacy, lab, community nurses, equipment, the doctor's letter, the GP — and nobody owns the list. **DischargeFlow is an AI discharge coordinator that owns the list.** For every medically-fit patient it builds the checklist from the record, kicks off all six jobs in parallel through the real systems, pauses for the doctor to sign the letter, chases what is stuck, frees the bed the moment it is safe, and proves the difference: the same ward run twice in the NHS simulator, with and without it, plus an eval suite on the agent's judgement.

NHS 10-Year Plan: Ch.2 hospital→community (discharge named explicitly), Ch.3 analogue→digital (admin off staff), Ch.6 transparency (measures that reach the team that can act), Ch.8 AI + interoperable data with evidence.

## 1. Why this is feasible today (verified live in a throwaway world, see docs/SIM_API.md)

| Job | Owner team | Sim actions that implement it | "Done" signal we read |
| --- | --- | --- | --- |
| Discharge letter | hospital doctor | `save_discharge_summary` (AI drafts 7 sections from chart) → **clinician sign-off (ADK yield)** → `process_document send` | letter status `sent`, visible in `GET /api/sites/gp/documents` |
| TTO medicines | pharmacy | `draft_prescription` (hospital) → pharmacy `link_prescription_stock` → `review` → `accept` → `dispense` → `collect` | prescription status `collected` |
| Outstanding results | lab | `order_test` (if plan needs it) → result appears after 120 sim-min → `review` | test status `available` + reviewed |
| Home visit / care | community nurses | `schedule_visit` → completes 90 sim-min later (capacity 4, 409 when full = real blocker) | visit `completed` |
| Equipment | equipment service | `create_referral target community "Equipment: …"` → community `accept` → `complete` (sim has no equipment service; referral models it) | referral `completed` |
| Receive letter, follow-up | GP practice | `process_document assign/review/file` + `create_task` follow-up → `accept` | letter `filed`, task `accepted` |
| **Free the bed** | ward | `update_attendance hospitalCommand: discharge` once all needed jobs are done | attendance `discharged` |

Two operational facts discovered: **sim writes and clock advances take ~3 s when the instance is healthy but degrade to 15–22 s under load, and the shared instance briefly returned 502s at 15:20 BST** (reads stay ~1 s). Design for the slow case and for outages (section 3.7 and 9).

We do **not** need another organiser key: `POST /api/keys {"teamName": …}` mints isolated worlds with identical seeds. Baseline world and agent world are two names.

## 2. Architecture

```
                 ┌──────────────────────────── ui/ (Vite+React) ─────────────────────────────┐
                 │ LEFT: the work — patients, 6-job checklist, agent log, approve letter,     │
                 │       blockers, evals tab.  RIGHT: the story — two lanes (without / with), │
                 │       patients bed→home, counters, clock.  SSE + REST from backend.         │
                 └───────────────▲───────────────────────────────────────────────▲────────────┘
                                 │ GET /api/state, SSE /api/events, POST tick/approve/reset   │
┌────────────────────────────────┴───────────────── backend/ (Node 22, tsx) ──────────────────┴───┐
│ server.ts (http + SSE)                                                                         │
│ engine/  tick loop: read world → build/update DischargeCase per inpatient → run 6 runners →    │
│          discharge when ready → emit events → metrics                                          │
│ agents/  ADK app: planner (which jobs, specifics) · letter_writer (drafts, yields for sign-off) │
│          · blocker_triage (severity, who to chase, message) — all Zod-structured                │
│ baseline/ manual-ward model: same runners, driven by "human polling" delays + dropped balls     │
│ sim/     typed client: bearer key, Idempotency-Key, expectedVersion refresh, concurrency=4      │
│ evals/   app.evaluate suites with toolMocks (never touch a world) + report JSON for the UI       │
│ scripts/ worlds:create · seed (identical cohort in both worlds) · run (A/B to horizon, saves JSON)│
└───────────────────────────────────────────────▲────────────────────────────────────────────────┘
                                                │ https://sim.animahacks.com  (world A = baseline, world B = agent)
```

## 3. Backend design (the part that solves the problem)

### 3.1 Sim client (`backend/src/sim/client.ts`)
`SimClient(key)` with `get(path)`, `action(site, body, idemKey)`, `advance(minutes)`, plus typed helpers: `attendances()`, `view(site, patient)`, `gpDocuments()`, `pharmacyWorkspace()`, `diagnostics(patient)`, `community(patient)`. `action` retries once on 409 by re-reading the resource version when the body carries `resourceId`. A tiny semaphore caps concurrent writes at 4 per world. Idempotency key = `${world}:${patientId}:${workstream}:${step}` so re-running a tick is safe.

### 3.2 Case model (`backend/src/engine/model.ts`)
```ts
type Job = 'letter'|'tto'|'labs'|'community'|'equipment'|'gp'
type JobStatus = 'not_needed'|'todo'|'in_progress'|'waiting'|'blocked'|'awaiting_approval'|'done'
interface JobState { status: JobStatus; step: string; evidence: {id, kind, status, version}[]; blocker?: string; startedAt?: number; doneAt?: number }
interface DischargeCase { patientId; name; attendanceId; attendanceVersion; location; fitAt: number;
  plan?: DischargePlan; jobs: Record<Job, JobState>; status: 'planning'|'in_progress'|'ready'|'discharged'; dischargedAt?: number; log: CaseEvent[] }
interface DischargePlan { needs: Record<Job, boolean>; tto: {drug,dose,unit,route,frequency,duration,quantity,indication}[]; labs: {panelId, reason}[]; visitPurpose?: string; equipment?: string[]; gpFollowUp: string; rationale: string }
```

### 3.3 Tick engine (`backend/src/engine/tick.ts`)
One tick = (1) advance the world clock by `tickMinutes` (60 for batch runs, 30 for live), (2) read: attendances, per-case hospital/community/diagnostics views, pharmacy workspace, gp documents (all reads ~1 s, run in parallel), (3) for each inpatient without a case: create case, run **planner** (LLM, cached per patient), (4) for each case run each needed job's runner (below) — runners are idempotent state machines that look at evidence and perform at most one sim write per job per tick, (5) if every needed job is `done` → `update_attendance discharge` → `discharged`, (6) emit `CaseEvent`s to the SSE bus and recompute metrics. Cases persist in memory + JSON snapshot (`data/<world>.json`) so the server can restart.

### 3.4 Runners (`backend/src/engine/jobs/*.ts`) — deterministic state machines
- Evidence matching rule for every runner: only resources with `provenance.created.actor.kind === 'team'` (ours) or `createdAt >= case.fitAt` count — most patients already carry seeded letters/tasks from the sim (`actor.kind === 'simulation'`). Exception: an existing *approved* seeded TTO (SIM-000001's r-3 Furosemide) may be completed rather than re-drafted.
- `letter`: no draft → run **letter_writer** (LLM reads chart: attendance, notes, problems, meds, results, plan) → `awaiting_approval` (ADK yield; UI shows sections, doctor edits/approves) → `save_discharge_summary` → `process_document send` → done.
- `tto`: for each plan med `draft_prescription` → find product in pharmacy catalogue by drug name (fallback: LLM picks closest product; no stock → `blocked: "no stock"` → triage) → `link_prescription_stock` → `review` → `accept` → `dispense` → `collect` → done.
- `labs`: `order_test` per plan panel → `waiting` until diagnostics view shows the test `available` (120 sim-min) → `review` → done. (Stretch: LLM flags abnormal → blocker.)
- `community`: `schedule_visit` → on 409 (capacity) `blocked` → triage escalates; else `waiting` until `completed` (90 min) → done.
- `equipment`: `create_referral` (target community) → community `accept` → `complete` → done.
- `gp`: waits for letter `sent` → `process_document assign` (Duty GP) → `review` → `file` → `create_task` follow-up → `accept` → done.
- Baseline mode uses the same runners but a `Scheduler` decides *when* each runner is allowed to act (3.7).

### 3.5 Agents (`backend/src/agents/`, ADK) — the model does judgement only
- `planner`: `app.agent` with tool `read_patient_summary` (conditions, needs, goals, complaint, active meds, care-plan/care-package) and `output: DischargePlanSchema`. Rules in system prompt (e.g. needs "Home visit"/"Carer involvement"/frailty → community; "Step-free access"/mobility → equipment; heart failure/CKD → U&E; every case needs letter + gp).
- `letter_writer`: tools `read_chart`, `read_plan`; `output: DischargeSectionsSchema` (7 non-empty sections; meds mentioned must come from chart/plan); then yielding tool `clinician_signoff` (`yieldSchema: {approved, editedSections?, note?}`) before `send_letter`. Session stored in memory (SQLite store if time) keyed by case; UI approval calls `session.input.tool({callId, input})` and re-runs.
- `blocker_triage`: `app.ask` with schema `{severity, escalateTo, message, suggestedAction}`; engine posts the message as a GP task/community referral so it is visible in the sim, and to the UI blockers panel.
- Model: `openai('gpt-5.6-luna')` for letter, `gpt-5.4-mini` for planner/triage. Adapter built from `OPENAI_KEY`.
- Stretch (only if everything else works): `coordinator` agent per case whose tools are the runners, so the LLM decides ordering each tick — the evals in 4 already cover its invariants.

### 3.6 Server (`backend/src/server.ts`, plain `node:http`, port 8787)
`GET /api/state` (worlds, clock, cases, metrics, last eval report) · `GET /api/events` (SSE) · `POST /api/tick {minutes}` (both worlds in parallel) · `POST /api/run {untilMinutes}` (loop ticks, streams) · `POST /api/approve/:patientId {approved, editedSections}` · `POST /api/reset` (new world suffix, seed cohort) · `GET /api/replay` (the saved A/B run for attract mode) · `POST /api/evals/run`.

### 3.7 Two worlds, one cohort, and the latency budget
- `scripts/worlds.ts`: mint `dischargeflow-baseline-<suffix>` and `dischargeflow-agent-<suffix>` (POST /api/keys), save to `.worlds.json` (git-ignored).
- `scripts/seed.ts`: identical cohort of 8 inpatients in both worlds: SIM-000007, SIM-000008 (already inpatient), SIM-000005 + SIM-000006 (take → `admit`), SIM-000001 (waiting → `assign/assess/refer/admit`; the sim's flagship delayed-discharge patient with bed r-47 "barrier: medicines and home monitoring"), SIM-000009…011 (`register_attendance` → … → `admit`). ~30 writes/world, ~3 min with 4-way concurrency. Mark `fitAt = clock.now` at seed time.
- **Baseline ("today's ward") model** (`backend/src/baseline/manualWard.ts`): same runners, but each team only looks at its inbox every `pollMinutes` (pharmacy 180, lab review 240, community 480, equipment 720, letter 480 = end of shift, GP 1440 = next day, ward round 120 for the actual discharge), jobs start sequentially (letter after labs back; TTO and GP after letter; community/equipment after the nurse sees the letter), and each poll drops the ball with p=0.25 (seeded RNG, re-noticed next poll). Parameters are *illustrative* and labelled as such in the UI.
- **Agent world**: all needed jobs start at tick 0 in parallel; bounded by lab 120 + visit 90 sim-min and the approval click.
- Cost of a full run: 8 patients × ~14 writes = ~110 writes per world plus 24 clock advances. Healthy sim (~3 s per write, 4-way concurrent): **~3–5 min for a 24-sim-hour A/B run**; loaded sim (15–22 s per write): ~15–20 min. So: run it as soon as the engine works (target 16:45), save `data/ab-run.json`, the UI **replays** it at 30× for the attract loop, and judges can also press "Advance 1 hour" live on the agent world. Re-run for fresh numbers only if the sim is healthy.

## 4. Evals and metrics (shown in the UI "Evidence" tab)

**Agent evals** (`backend/src/evals/`, `app.evaluate`, mocked sim, run in <2 min, no world touched):
- planner: 8 fixture patients → expected `needs` (e.g. frailty+step-free ⇒ community+equipment; heart failure ⇒ labs U&E) — metric `plan_matches_expected` (per-job precision/recall) and `plan_always_has_letter_and_gp`.
- letter_writer: `read_chart_before_drafting` (eventSequenceMetric), `all_seven_sections_nonempty`, `no_invented_medications` (every drug named in `medicationChanges` ⊆ chart meds ∪ plan TTOs), `never_sends_without_signoff` (no `send_letter` call before `clinician_signoff` input), `rejected_signoff_does_not_send`.
- blocker_triage: community 409 ⇒ escalates to community lead with severity ≥ medium; no-stock ⇒ pharmacy; never proposes discharging.
- engine invariants (scripted, `runTest`/plain vitest): `never_discharge_with_open_job`, `idempotent_tick` (running a tick twice makes no extra writes).
- Report: pass rate per metric, tokens + cost, `repeat: 3` for flakiness if time.

**Outcome metrics** (from the two-world run): per patient time from fit-to-discharge → discharged; bed-hours occupied after fit; patients home by 6h/12h/24h; jobs completed; blockers raised and resolved; letters filed by GP. Headline: **bed-hours saved = Σ(baseline − agent)** and "patients still in a bed at 24 h".

## 5. UI (`ui/`) — Vite + React, one page, dark theme, big type

- **Left "The work" (60%)**: world clock + controls (Advance 1h · Run to 24h · Reset · Replay); patient cards: name, age, bed, complaint, time since fit; six chips (letter · TTO · labs · community · equipment · GP) coloured by status, "not needed" greyed with the planner's reason on hover; expand → evidence (sim resource ids/status/version, links to the portal), agent log (ledger events), blockers with the triage message; **Approve letter** modal (7 sections, editable, Approve/Reject). Tabs: Ward · Blockers · Evidence (eval report + outcome metrics).
- **Right "The story" (40%)**: two horizontal lanes labelled "Today's ward" and "With DischargeFlow", each with the same 8 patient avatars moving from a bed icon to a home icon; a progress ring per avatar (jobs done/needed); flashes when a job completes or a blocker appears; live counters: **beds freed**, **bed-hours saved**, **patients home**; sim clock ticking. Attract mode auto-replays the saved run in a loop so passers-by get it in 20 s.
- Data: `GET /api/state` on load, `EventSource('/api/events')` for updates, `GET /api/replay` for attract mode.

## 6. Demo script (3 min, also the video)
1. Problem (20 s): the bed that stays full for six reasons. 2. Show the sim portals: Amira Khan in Hospital EPR, bed 12 "barrier: medicines and home monitoring". 3. Start DischargeFlow: planner creates checklists for 8 patients; the six jobs light up in parallel. 4. Approve a letter (show it was drafted from the chart). 5. Advance time: labs and visits complete, pharmacy dispenses, GP files; beds free. 6. A blocker: community capacity exhausted → escalation visible in the sim. 7. Right panel: same ward without it, still full at 24 h; counters. 8. Evidence tab: evals pass rates, no invented meds, never sends without sign-off. 9. Close: Ch.2/3/6/8 and "this ran against real (simulated) systems, not slides".

## 7. Schedule and owners (BST)

| When | A — engine (Zaki: has env + repo) | B — agents + evals | C — UI | D — story: baseline, A/B run, video, submission |
| --- | --- | --- | --- | --- |
| 15:00–15:30 | sim client + `worlds`/`seed` scripts; smoke against a throwaway world | ADK app + planner with fixtures | Vite app, layout, mock state JSON | baseline scheduler model; metrics definitions; storyboard video |
| 15:30–16:15 | case model + tick engine + runners letter/tto/labs | letter_writer + yield/approval + evals for planner/letter | left panel from `/api/state` + SSE, approval modal | A/B `run` script writing `data/ab-run.json`; right panel spec with C |
| 16:15 **checkpoint** | one patient discharged end to end in the agent world, visible in the portals | evals run green offline | UI shows live cases | baseline runs one patient |
| 16:15–17:00 | runners community/equipment/gp; blockers → triage; server endpoints | blocker_triage + engine invariants; eval report JSON | right panel lanes + counters + replay | full A/B run started ~16:45 (20 min) |
| 17:00–17:45 | fix what the run exposed; idempotency; reset | wire eval report into UI Evidence tab | polish, attract mode | record video from the working UI + portals |
| 17:45–18:15 | feature freeze; README; repo access for judges | | | submit form; re-check video link opens logged-out |
| 18:30–19:30 | stall: one person demos live (agent world + Advance 1h), one narrates story panel | | | |

Mentor clinic 2 (15:15–16:15): one person, 20 min, ask Souradip about (a) anything that makes sim actions faster, (b) whether a community/equipment referral is the right modelling, (c) what a discharge coordinator would want on the screen.

## 8. Cut lines (drop in this order if behind)
1. Agentic coordinator (stretch) — never start it before 17:00. 2. SQLite store for approvals (in-memory is fine for the demo). 3. Equipment as its own lane (fold into community referral). 4. `repeat` runs in evals. 5. Live "Reset" (pre-seeded worlds are enough). 6. Blocker triage LLM (hard-code the escalation text). Never cut: letter approval yield, A/B replay, evals tab, video.

## 9. Risks
- **The shared sim goes down.** At 15:20 BST `https://sim.animahacks.com/healthz` returned 502 for several minutes (16 teams on one instance; our own 4-way concurrent writes may add load). The client retries 5xx with backoff, but the demo must not depend on the sim being up: the UI's attract loop replays `data/ab-run.json`, and the video is recorded early. Keep writes ≤ 4 concurrent per world and prefer fewer, larger clock advances.
- **Write latency (3 s healthy, up to 20 s under load)** — mitigated by 4-way concurrency, one write per job per tick, pre-recorded A/B run, replay in UI. Do not put sim writes on the UI thread of the demo; show progress.
- 409 on community capacity (only 4 slots) — this is a feature (blocker story); handle it, don't crash.
- World creation ~1–2 min — create the demo worlds by 16:30, keep the suffix in `.worlds.json`, do not recreate during the stall.
- OpenAI rate/latency — planner and triage on `gpt-5.4-mini`; cache plans per patient on disk.
- Judges asking "is the baseline real?" — say it is an illustrative model with stated parameters; the agent side is real API traffic (show the Activity trail in the portal with our team name as actor).

## 10. Decisions for the team (make them in the first 10 minutes)
- Product name: DischargeFlow (placeholder — change everywhere with one grep).
- UI framework: Vite + React + inline CSS/Tailwind CDN. No component library.
- Approval UX: in our UI (not the sim portal) — one click, edits optional.
- Baseline parameters as in 3.7 unless a mentor gives better ones.
