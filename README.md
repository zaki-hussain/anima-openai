# DischargeFlow

AI discharge coordinator built at the OpenAI x Anima Healthtech Hackathon (12 Sep 2026). Start with `CLAUDE.md`, then `PLAN.md`. References: `docs/SIM_API.md`, `docs/ADK.md`, `docs/HACKATHON.md`.

```bash
cd backend && npm i
export OPENAI_API_KEY="$OPENAI_KEY"
npm run smoke                 # read-only look at the take/inpatient list in the team world
npm run worlds:create         # mint baseline + agent worlds → .worlds.json (git-ignored)
npm run seed                  # identical 8-patient inpatient cohort in both worlds
```
