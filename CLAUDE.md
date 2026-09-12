# DischargeFlow — AI discharge coordinator (OpenAI x Anima hackathon, Team 1, 12 Sep 2026)

Read this first. Then `PLAN.md` (what we are building, who does what, in what order) and the three references in `docs/`.

## The problem in one paragraph

Patients who are medically fit sit in hospital beds for hours or days because discharge is six parallel jobs owned by six teams — pharmacy (TTO medicines), the lab (outstanding results), community nurses (home visit / care package), equipment (frame, rails, commode…), the hospital doctor (discharge letter) and the GP practice (receive and action the letter, arrange follow-up) — and nobody owns the list. DischargeFlow owns the list: an agent per patient that builds the discharge checklist from the record, drives every workstream through the real systems, pauses for clinician sign-off where it matters, chases blockers, frees the bed the moment everything is done, and measures itself. It maps to NHS 10-Year Plan Ch.2 (hospital → community; discharge is named explicitly), Ch.3 (analogue → digital, less admin), Ch.6 (transparent, actionable quality measures) and Ch.8 (AI + interoperable data, with evidence). See `docs/HACKATHON.md` for judging criteria and deadlines.

## Non-negotiable facts

- **Submission closes 18:30 BST today. Video + repo access to judges by then.** Demo stalls 18:30–19:30.
- Environment variables already set in our dev environment: `SIM_API` (team key for world `team-f0d29024a66f`, team `team1experiment`) and `OPENAI_KEY` (OpenAI key; the ADK expects `OPENAI_API_KEY`, so export `OPENAI_API_KEY="$OPENAI_KEY"` or register an adapter — see `docs/ADK.md`). Never commit either.
- The sim is the demo stage. All communication between teams happens through its API: `https://sim.animahacks.com` (reference: `docs/SIM_API.md`). Prove actions landed by opening the portals with the same key.
- **We can create as many isolated worlds as we want** with `POST /api/keys {"teamName": "..."}` — no organiser key needed. Every world starts from the identical seed. Use one world for the "without DischargeFlow" baseline and one for "with DischargeFlow". First creation of a world takes ~1–2 min.
- Keep the team's main world (`SIM_API`) clean for browsing in the portals. Run automated tests and experiments in throwaway worlds named `dischargeflow-<purpose>-<suffix>`.
- Sim writes and clock advances are ~3 s each when the instance is healthy, 15–22 s under load, and the shared instance can return 502s for minutes (it did at 15:20 BST). The client retries; the demo must also work from a recorded run. Reads are ~1 s except the unfiltered GP view (never call `/api/sites/gp/view` without `?patient=`). Actions on existing records need `resourceId` + `expectedVersion`; always send an `Idempotency-Key`; on 409 re-read and retry once.
- Sim time only moves when we advance it: `POST /api/clock {"paused": true, "advanceMinutes": N}`. Lab results take 120 sim-min, community visits 90.
- Stack: Node 22, TypeScript, `@animahealth/adk` 0.6.0 (`docs/ADK.md`), `zod`, `openai`. Backend runs with `tsx` (no build step). UI is Vite + React. Keep dependencies minimal.
- Models on our key: `gpt-5.6-luna` (default for judgement), `gpt-5.4-mini` (bulk/cheap). Verified list in `docs/ADK.md`.

## Repo layout (target)

```
CLAUDE.md               this file
PLAN.md                 the build plan, schedule, owners, cut lines, demo script
docs/HACKATHON.md       event facts, judging, chapter mapping
docs/SIM_API.md         everything we know about the sim API (verified live)
docs/ADK.md             Anima ADK cheat sheet for this project
backend/                TypeScript: sim client, discharge engine, ADK agents, evals, HTTP+SSE server
ui/                     Vite + React demo dashboard (left: the work; right: the two-world story)
```

## Conventions

- Deterministic mechanics live in code (steps/runners). The model is used for judgement only: the per-patient discharge plan, drafting the discharge letter from the chart, triaging blockers and writing escalations, and summaries. Every model call has a Zod output schema.
- Anything that changes a patient's record in a way a clinician would sign (the discharge letter, the discharge itself) goes through an ADK yielding tool → human approval in the UI.
- Every sim mutation is a tool/step with `Idempotency-Key = <world>:<patient>:<workstream>:<step>` so re-running a tick is safe.
- Log everything to the ADK session ledger and mirror to the UI over SSE. The ledger is the audit trail we show judges.
- Evals are code: `backend/src/evals/*` using `app.evaluate` with `toolMocks` so suites never touch a real world. Outcome metrics (bed-hours, delays) come from the live two-world run and are shown in the UI.
- Never overclaim. The baseline world is an *illustrative* model of manual working (parameters in `backend/src/baseline/`), the patients are synthetic, and no clinical advice is produced.

## Commands (once scaffolded on the work branch)

```bash
cd backend && npm i
export OPENAI_API_KEY="$OPENAI_KEY"
npm run smoke            # read the team world, print inpatients + discharge checklist
npm run worlds:create    # mint baseline + agent worlds, write .worlds.json
npm run seed             # admit the same cohort of inpatients into both worlds
npm run dev              # HTTP + SSE server on :8787 driving both worlds
npm run evals            # ADK eval suites (offline, mocked sim)
cd ../ui && npm i && npm run dev   # dashboard on :5173
```

## Git

`main` holds docs and the plan. Build on `claude/jolly-bohr-i4djf0` (or feature branches off it), merge to `main` when something works end to end. Small commits with clear messages. Never commit keys or `.worlds.json`.
