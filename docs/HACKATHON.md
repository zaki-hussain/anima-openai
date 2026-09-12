# OpenAI x Anima Healthtech Hackathon — event facts that matter

Trimmed from the challenge brief. Only what affects what we build, when, and how it is judged.

## Team

**Team 1**: Zaki Hussain, Clement Tong, Sadaf Sohrabi, Lorcan Purcell.
Mentors for Teams 1–3/1–4: Laura Walker (Head of Ops, Royal Primary Care — voice of customer) and Souradip Mookerjee (Clinical Engineering Lead, Anima — technical, also a judge).

## Date, deadlines (Saturday 12 September 2026, OpenAI London HQ, times are local/BST)

| Time | What |
| --- | --- |
| 10:45–11:45 | Mentor clinic 1 (one 20-min slot per team; bring specific questions) |
| 13:00–13:30 | Talk: Building frontier agents — Wulfie Bain, OpenAI |
| 15:15–16:15 | Mentor clinic 2 |
| 16:15–18:15 | Final build session |
| 18:15–18:30 | Final uploads; check video + repo access |
| **18:30** | **Submissions close** (latest complete submission counts) |
| 18:30–19:30 | Live demo stalls (judges + participants visit); People's Choice voting |
| 19:50 | Awards |

Discord: animahacks.com/discord. Support: hackathon-support@animahealth.com.

## Submission requirements

- Submit via the project-submission form by 18:30.
- Video hosted with no sign-in (Loom / unlisted YouTube / Drive). Must show: (1) the problem, (2) the working product, (3) how it improves patient care or NHS work.
- Repo: public, or private with judge access granted before the deadline (shun@animahealth.com, wulfie@openai.com, souradip@animahealth.com, tt@openai.com).
- Keep one person at the demo stall 18:30–19:30.

## Judging (each criterion 1–10, equal weight; panel agrees final awards)

1. **NHS relevance and impact** — how directly the product advances an identifiable 10-Year Plan priority, and the importance of the outcome.
2. **Quality of the working product** — how well it works in the demo, coherence, how effectively the stated problem became a working product built today.
3. **Originality** — technology, product, clinical/operational model, or the combination.

Judges: Shun Pang (CEO Anima), Wulfie Bain (Applied AI Lead OpenAI), Souradip Mookerjee (Clinical Eng Lead Anima), Tricia Troth (EMEA Head of Startups OpenAI).

Prizes: 1st £7.5k + 8 Sleep, 2nd £5k, 3rd £2.5k. Tracks: best voice-based solution (Pocket); People's Choice (Hilo).

## The mission

Build a working product that directly advances one or more priorities in the NHS 10-Year Health Plan (July 2025). Must address an identifiable priority, work well enough to demo today, and be substantially built during the hackathon.

### Chapters we anchor on (and how our discharge product maps to them)

- **Ch.2 From hospital to community** — explicitly names *discharge and rehabilitation*, urgent community response, virtual wards, shared care plans. The plan's framing: "moving staff, funding, information and accountability across organisational boundaries". Our product is exactly a cross-boundary accountability layer for discharge.
- **Ch.3 From analogue to digital** — "tools that reduce administrative work for staff", records that follow patients between settings, connected information. We remove the manual chasing of six teams.
- **Ch.6 A new transparency of quality care** — timely, comparable, useful measures that reach the teams able to act. Our evals + live metrics (bed-hours lost per blocker, time-to-discharge) are that.
- **Ch.8 Powering transformation** — AI and interoperable data as big bets; the gap between trial and routine use. Our evals speak to "evidence" and safe adoption.

### Appendix ideas the organisers listed (for context; apply an original take if reusing)

1. Never lose a patient between services (closed-loop referrals). 2. Conversation → action. 3. Automate clinical document processing (incoming letters / discharge correspondence — HSSIB investigation). 4. Voice agent for every accent. 5. Preventative care opportunities. 6. Surface quality issues.

Our problem (delayed discharge of medically-fit patients because six parallel jobs across six teams have no owner) sits between 1 and 3 but is framed operationally, not as a referral or document product.

## Tools provided

- Simulated NHS neighbourhood: https://sim.animahacks.com/control/ (docs https://sim.animahacks.com/docs/, OpenAPI https://sim.animahacks.com/api/openapi.json). 50,000 synthetic patients per team world; GP practice, hospital EPR, pharmacy, community visit board, home dashboard, NHS-shaped adapter APIs. Team controls simulation time. See `docs/SIM_API.md`.
- Anima ADK: https://adk.animahealth.com/ — TypeScript agent framework (`npm install @animahealth/adk`, Node ≥ 22). See `docs/ADK.md`.
- OpenAI API key — provided per team (env var `OPENAI_KEY` in our environment).
