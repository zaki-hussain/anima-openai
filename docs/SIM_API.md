# NHS-SIM API — working reference for this project

Source of truth: https://sim.animahacks.com/api/openapi.json (OpenAPI 3.1) and https://sim.animahacks.com/docs/handbook.json (all guides as JSON). Interactive explorer: https://sim.animahacks.com/docs/explorer/. Everything below was verified live on 12 Sep 2026 against our worlds.

## Auth, worlds, keys

- Base URL: `https://sim.animahacks.com`. All team calls: header `Authorization: Bearer <team key>`.
- Our team key is in env var **`SIM_API`** (value starts `sim_…`). It belongs to team `team1experiment`, world `team-f0d29024a66f`, scopes `gp, hospital, community, pharmacy, diagnostics, referrals, wearables`. Confirm with `GET /api/team`.
- **You can mint extra isolated worlds yourself — no organiser needed.** `POST /api/keys` (public, no auth) with `{"teamName":"any name"}` creates or joins a world and returns `{apiKey, team, world, scopes, created}`. Names are lowercased with whitespace removed and act as join codes (anyone with the name joins the world), so use distinctive names, e.g. `dischargeflow-baseline-<suffix>` and `dischargeflow-agent-<suffix>`. Repeating the name returns the same key. Creation takes ~1–2 minutes the first time (population seeding); reads afterwards are fast.
- Every new world starts from the same seed: 50,000 synthetic patients, the same 8 authored patients (`SIM-000001`…`SIM-000008`) with the same hospital attendances, documents, prescriptions, tasks. That makes A/B world comparison fair.
- Nothing here is real. Patient IDs are `SIM-xxxxxx`. No clinical advice is provided by the sim.

## Simulation clock

- `GET /api/clock` → `{now (unix ms), paused, speed, events[]}`. Our worlds start paused at `now = 1789200000000` (2026-09-12T00:00:00Z sim time).
- `POST /api/clock` body `{ "paused": true, "advanceMinutes": N }` pauses and advances, **executing due jobs** (lab results, visit completions, deliveries, wearable readings). Advancing while running returns 409, so always send `paused: true` in the same request. Response includes clock + visible action events (there is no separate event stream endpoint; poll `GET /api/clock` events, max 100).
- `speed` (default 60) only matters when un-paused. For demos, keep paused and step explicitly.
- Known delays: lab result 120 sim-min (`collection: "now"`) or 240 (`next-round`); community visit completes 90 sim-min after `schedule_visit`; wearable first reading 10 min then hourly; pharmacy supplier orders have their own due times.

## Read endpoints (team key)

| Endpoint | Returns |
| --- | --- |
| `GET /api/team` | `{team, world, scopes}` |
| `GET /api/catalogue` | sites, adapters, scenarios (incidents an operator can enable: pathology-outage, staff-shortage, robot-failure, demand-surge, wearable-disconnect, winter-pressure…) |
| `GET /api/sites/{site}/view?patient=SIM-000001&offset=0&limit=500` | `{id, now, speed, paused, population, counters, resources[], resourceTotal, resourceOffset, resourceLimit, staffing, faults, events}`. `site` ∈ `gp, hospital, community, pharmacy, diagnostics, referrals, wearables, patient`. Without `patient` the GP view is huge (374k resources, paginated 500) — always filter by patient or use the specialised endpoints. Includes service resources with no patient (capacity etc.). |
| `GET /api/sites/{site}/patients?q=<name/id/condition/need/goal>&offset=0` | `{items[], total}`, fixed page size 30 |
| `GET /api/sites/hospital/attendances` | `{resources[] (kind hospital-attendance), patients[], now}` — the A&E/take/inpatient list |
| `GET /api/sites/hospital/documents` | hospital discharge summaries (drafts + sent) with patients |
| `GET /api/sites/gp/documents` | discharge letters visible to the GP inbox with processing status (`sent` → `reviewed` → `filed`) |
| `GET /api/sites/pharmacy/pharmacy-workspace` | prescriptions, pharmacy-referrals, products (catalogue), stock movements, supplier quotes, orders, baskets |
| `GET /api/sites/gp/messaging-workspace` / `GET /api/sites/patient/messaging-workspace?patientId=` | Messagey conversations + templates |
| `GET /api/sites/gp/appointments?date=YYYY-MM-DD` | appointment sessions and slots |
| `GET /api/sites/wearables/devices|readings?patient=&metric=` | home devices / readings |
| `GET /api/nhs/{adapter}?patient=SIM-…` | FHIR-ish `Bundle` projections. Adapters: `pds` (Patient search/read), `ods` (Organization), `dos`, `ers` (referrals → ServiceRequest), `eps` + `eps-tracker` (prescriptions → MedicationRequest), `gp-connect` (GP tasks → Task, max 100), `mesh` (messages → Communication), `scr` (documents), `pathology` / `radiology` (DiagnosticReport), `appointments`. Tagged `SIMPLIFIED-MOCK-NOT-FHIR-CONFORMANT`. |
| `GET /api/nhs/pds/Patient?family=&given=&birthdate=&identifier=&_count=&_offset=` and `/Patient/{id}` | FHIR R4 Patient (gp scope) |

### Resource envelope (every record)

```json
{ "id": "r-47", "kind": "bed", "title": "Acute medical bed 12", "status": "occupied", "owner": "beds",
  "visibleTo": ["beds","hospital","community","pharmacy"], "patientId": "SIM-000001", "priority": "urgent",
  "createdAt": 1789200000000, "dueAt": 1789286400000, "version": 1, "data": { ... kind-specific ... },
  "provenance": { "created": {"actor":{"kind":"team|simulation","name":"…"},"source":"hospital","action":"…","time":…,"version":1}, "changes": [] } }
```

Patient shape: `{id, name, birthDate, localIds{gp,hospital,legacy}, conditions[], needs[], goals[], synthetic: true}`.

## Write endpoint — one action envelope

`POST /api/sites/{site}/actions` with JSON body `{ "type": "<action>", ...fields }`. Headers: `Content-Type: application/json`, and **`Idempotency-Key: <unique per logical action>`** (reuse the same key + identical body to retry; a changed body with the same key → 409). Updates to existing records need `resourceId` + `expectedVersion` (current `version`); stale version → 409, re-read and retry. Errors are JSON `{error}`; 400 bad input, 401 key, 403 scope/ownership, 404, 409 conflict/invalid transition, 413 body > 64 KB. Adapter routes `POST /api/nhs/{adapter}/actions` accept the same envelope and delegate to the matching site.

Action `type` enum (all sites; the engine rejects types not valid at that site/state): `hospital_note, save_discharge_summary, process_document, messaging_action, place_pharmacy_order, update_pharmacy_basket, remove_pharmacy_basket_line, checkout_pharmacy_basket, cancel_pharmacy_order, receive_pharmacy_order, receive_pharmacy_referral, update_pharmacy_referral, receive_stock, update_stock_price, link_prescription_stock, register_attendance, update_attendance, connect_device, create_task, create_referral, order_test, draft_prescription, book_appointment, create_appointment_session, set_appointment_slot, arrive_appointment, cancel_appointment, save_consultation, save_problem, save_allergy, send_message, schedule_visit, dispatch_robot, review, accept, complete, reject, dispense, collect, share_record, report_absence, restore_staff, allocate_shift`.

### The actions our discharge workflow uses (all verified live)

**Hospital flow (site `hospital`)**

| Purpose | Body |
| --- | --- |
| Register A&E attendance | `{"type":"register_attendance","patientId":P,"title":"Presenting complaint","acuity":"3","location":"Majors 2","clinician":"Dr X"}` (clinician optional) |
| Progress attendance | `{"type":"update_attendance","resourceId":"hospital-attendance-…","expectedVersion":v,"hospitalCommand":"assign|assess|refer|admit|discharge", ...}` — `assess` needs `clinician`; `admit` needs `location` (inpatient location); `discharge` needs `disposition` (free text). Stages: `waiting → assessing → take → inpatient → discharged`. Discharging does **not** write or send a letter. |
| Write discharge summary draft | `{"type":"save_discharge_summary","patientId":P,"title":"Discharge summary · …","dischargeSections":{"reason","course","diagnoses","medicationChanges","results","followUp","gpActions"}}` → resource kind `discharge-summary`, status `draft`, visibleTo hospital only. Update: add `resourceId`+`expectedVersion`. All 7 sections must be non-empty to send. |
| Send letter to GP | `{"type":"process_document","documentCommand":"send","resourceId":id,"expectedVersion":v}` → status `sent`, visibleTo hospital+gp. |
| Annotate letter | `{"type":"process_document","documentCommand":"annotate","resourceId":id,"expectedVersion":v,"documentTags":["Follow-up needed"],"documentSnomedCodes":[{"code":"195967001","display":"Asthma"}]}` (both arrays required) |
| Clinical note | `{"type":"hospital_note","patientId":P,"title":"…","hospitalNoteCommand":{"kind":"save","template":"progress|free-text|history-physical","sections":[{"id":"s1","heading":"…","text":"…"}]}}`; sign `{"kind":"sign"}`; addendum `{"kind":"addendum","text":"…"}` (with resourceId/expectedVersion). Signed text is immutable. |
| Order blood test | `{"type":"order_test","patientId":P,"title":"…","bloodTestOrder":{"panel":"Urea and electrolytes","panelId":"ue","specimen":"blood","priority":"routine|urgent","collection":"now|next-round","clinicalDetails":"…"}}` → kind `test` owner `diagnostics`, status `open`; result appears in `/api/sites/diagnostics/view?patient=` after 120/240 sim-min. panelId ∈ `fbc, ue, hba1c, lft, crp, lipids`. |
| Draft TTO prescription | `{"type":"draft_prescription","patientId":P,"title":"TTO: …","medicationOrder":{"drug","dose","unit","route","frequency","duration","quantity":56,"indication"}}` → kind `prescription`, owner `pharmacy`, status `draft`. |
| Arrange community visit | `{"type":"schedule_visit","patientId":P,"title":"Post-discharge home visit"}` → kind `visit`, owner `community`, status `scheduled`; completes 90 sim-min later (or `complete` it via community actions). Consumes community capacity (`capacity-community`, 4 slots); exhausted → 409. Works from gp/hospital/community sites. |
| Refer to another service | `{"type":"create_referral","patientId":P,"title":"Community equipment: frame and rails","target":"community"}` → kind `referral`, owner = target, status `open`, visibleTo target+hospital+patient+referrals. Targets: `gp, hospital, community, pharmacy, diagnostics, referrals, wearables`. Used for our "equipment" workstream (the sim has no equipment service). |
| Create a task | `{"type":"create_task","patientId":P,"title":"…","target":"gp"}` — at site gp creates `task` owner gp. Progress: `review`/`accept`/`complete`/`reject` with resourceId+expectedVersion. |
| Share a record | `{"type":"share_record","resourceId":id,"expectedVersion":v,"target":"gp"}` |
| Message a patient | `{"type":"send_message","patientId":P,"title":"…","text":"…"}` → kind `message`, owner `patient` (this is a patient-facing message, not inter-team). |

**Pharmacy flow (site `pharmacy`)** — for a `prescription` resource: `link_prescription_stock` (`resourceId, expectedVersion, productId, quantity` in units; product ids from the workspace `pharmacy-product` list, e.g. search by drug name) → `review` → `accept` (status `approved`) → `dispense` (deducts stock) → `collect`. Seeded prescription `r-3` for SIM-000001 (Furosemide, "Discharge medication supply") is already `approved`. If stock is insufficient, `place_pharmacy_order`/`receive_pharmacy_order` first (or pick a product with stock). Pharmacy First referrals: `receive_pharmacy_referral` (`pharmacyPathway`, `referralSource`) then `update_pharmacy_referral` with `pharmacyCommand: accept|consult|complete`.

**GP flow (site `gp`)** — letters land in `GET /api/sites/gp/documents` with status `sent`. Process with `process_document`: `assign` (`clinician`), `review` (`text`), `file` (`text`) — file requires a recorded review. Tasks: `create_task` then `accept`/`complete`. Consultations: `save_consultation` (`title, text, mode: in-person|telephone|video|online, consultationStatus: draft|saved`). Problems/allergies: `save_problem` (`problemStatus active|resolved`), `save_allergy`. Appointments: `book_appointment` (`sessionId, sessionVersion, startsAt, patientId, title`), `arrive_appointment`, `complete`, `cancel_appointment`. Results review: `review` on the test resource. Messagey: `messaging_action` with `messagingCommand: {kind: create|send|reply|note|assign|complete|reopen|delivery|retry|save_template|archive_template, …}`.

**Community (site `community`)** — `complete` a visit; view shows `care-plan` (e.g. r-36 "Home support not yet arranged", data `{carerAvailable:false, homeAccessConfirmed:false}`), `care-package` (r-44 "Home care assessment awaiting allocation", `{keySafe:false, visitsPerDay:2, fundingDecision:"pending"}`), `device`, `capacity-community`.

## What the seeded world contains that matters for discharge (identical in every new world)

- Hospital attendances (kind `hospital-attendance`, ids `hospital-attendance-seed-0..7`, all version 1): SIM-000001 waiting (Breathlessness, acuity 2), SIM-000002 waiting, SIM-000003 waiting, SIM-000004 assessing (Dr Alex Morgan), SIM-000005 take (Majors 2), SIM-000006 take (AMU bed 1, "Reduced mobility", frailty), **SIM-000007 inpatient (AMU bed 2, chest discomfort, awaiting elective surgery), SIM-000008 inpatient (AMU bed 3, fall at home)**.
- Bed resource `r-47` "Acute medical bed 12", status `occupied`, patient SIM-000001, data `{ward:"AMU", barrier:"medicines and home monitoring", expectedDischarge:"today"}` — the sim's own delayed-discharge signal.
- SIM-000001 Amira Khan (heart failure, CKD; needs home visit + carer involvement): hospital `document` r-1 "Discharge: monitoring required; medication list changed" (urgent), prescription r-3 approved (Furosemide), GP task r-2 "Arrange post-discharge monitoring", messages r-6 (respiratory) and r-7 "Discharge & flow: confirm medication handover" (channel discharge-and-flow, visible to hospital/pharmacy/community), discharge summary `discharge-summary-example` already sent.
- SIM-000006 Eleanor Chen (frailty, step-free access): community care-plan r-36 (home support not arranged), care-package r-44 (awaiting allocation, funding pending), wearable device r-14.
- SIM-000002: referral r-4 rejected (missing imaging). SIM-000007: surgery r-37 + theatre-slot r-46 + ambulance handover r-51.
- 61 seeded discharge letters (`document-batch-*`) across many patients: 37 sent, 12 reviewed, 8 filed, 4 hospital-only drafts. 13 open GP tasks "Confirm follow-up arrangements".
- Capacity: hospital 2, beds 2, community 4, gp 6 slots. Staffing: 4 doctors, 4 nurses, 8 staffed spaces.
- Patients beyond the first 8 (`SIM-000009`…) have GP records, encounters, lab history but no hospital attendance; use `register_attendance` → `assess` → `refer` → `admit` to create an inpatient cohort deterministically in both worlds.

## Latency and limits (measured)

- World creation: slow (minutes). Reads: sub-second to a few seconds; the unfiltered GP view is slow and huge — never call it in a loop. Actions: ~1–3 s each. Budget for it in demo loops; parallelise across patients where safe (different resources), never race on the same resource version.
- JSON bodies ≤ 65,536 bytes. Resource views page at 500. Adapters return at most 100 workflow resources.
- No rate limit documented, but be polite: cache reads per tick.

## Browser portals (same team key)

Map https://sim.animahacks.com/control/ → Riverside Practice (GP Records `/gp/`, Document Inbox `/gp/documents/`, Messagey `/gp/messages/`), Northbank General (Hospital EPR `/hospital/`: Patient List Manager, A&E tracking, Medical take, Inpatient census, Discharge summaries, Handover), High Street Pharmacy `/pharmacy/`, Neighbourhood Care `/community/`, At home. Use these during the demo to *prove* the agent's actions landed in the real systems (Activity trail shows the acting team name). Enter the API key via the "existing key" option.
