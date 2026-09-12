# Anima ADK — working reference for this project

Docs: https://adk.animahealth.com/ (chapters: quickstart, primitives, tools, context, sessions, multi-agent, yielding, structured-output, testing, evals, stores, serving, streaming, guardrails, workflows). Repo: https://github.com/mycontinuum-com/adk. Package `@animahealth/adk` **v0.6.0** (MIT), Node ≥ 22, peer `zod ^3.25`. OpenAI provider needs `openai ^5` installed.

```bash
npm i @animahealth/adk zod openai
```

Subpaths: `@animahealth/adk` (core), `/openai` `/gemini` `/claude`, `/testing`, `/eval`, `/stores/sqlite|postgres|dynamodb`, `/agui`, `/cli`, `/web`, `/voice`, `/workflow` (experimental).

## OpenAI key

The OpenAI adapter reads **`OPENAI_API_KEY`** (or `AZURE_OPENAI_ENDPOINT`+`AZURE_OPENAI_API_KEY`, or `OPENAI_EU_API_KEY`). Our environment provides the key as **`OPENAI_KEY`**, so either export `OPENAI_API_KEY="$OPENAI_KEY"` or register an adapter explicitly:

```ts
import { adk } from '@animahealth/adk'
import { OpenAIAdapter, openai } from '@animahealth/adk/openai'
const app = adk({ adapters: { openai: new OpenAIAdapter([{ type: 'openai', apiKey: process.env.OPENAI_KEY }]) } })
```

Models verified available on our key (12 Sep 2026): `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.2`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1(-mini/-nano)`, `gpt-4o(-mini)`, `o3`, `o4-mini`, realtime/audio/tts/whisper models. Default to `openai('gpt-5.6-luna')` for judgement, `gpt-5.4-mini` for cheap bulk calls. Reasoning option: `openai('gpt-5.6-luna', { reasoning: { effort: 'minimal|low|medium|high' } })` (temperature is dropped when reasoning is set).

## Core mental model

- **One app, one schema.** `adk({ name, schema: { session: {...zod}, user?, patient?, practice?, org?, team? }, store?, adapters? })`. `ctx.state.x` reads/writes typed session state; every write is a `state_change` event.
- **One ledger.** A session is an append-only event list (`user, system, invocation_start, model_start, thought, tool_call, tool_result, tool_yield, tool_input, state_change, annotation, assistant, invocation_end …`). State is replayed from it. `run.session.events` is the audit trail — perfect for a live UI feed and for evals.
- **Five runnables**: `app.agent({name, model, context, tools, output?, yields?})`, `app.step({name, execute(ctx)})` (pure TS; may return another runnable to delegate/route), `app.sequence({runnables})`, `app.parallel({runnables, merge?, minSuccessful?})`, `app.loop({runnable, while, maxIterations})`. Run any with `await app.run(runnable, 'message' | { input: { message, initialState, state }, session })` → `RunResult {status, output{text,value,items}, state, session, usage}`.
- **Tools**: `app.tool({ name, description, schema: z.object(...), execute(ctx) })`. `ctx.args` parsed+coerced; `ctx.state`; `ctx.session`; `ctx.signal`; `ctx.note(msg, {kind:'phase'|'log'|'mark', label, data})` for progress annotations. Optional `prepare`, `finalize`, `retry: {maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier}`, `timeout` ms. A thrown error becomes a `tool_result` with `error` the model reads — write error messages for the model.
- **Yielding (human-in-the-loop)**: add `yieldSchema: z.object({...})` to a tool → run returns `status: 'yielded_tool'` with `yieldedTools[{callId, name, args}]`; the session sleeps as rows. Resume with `session.input.tool({ callId, input })` then `app.run(runnable, { session })`. `execute` then sees `ctx.input`. Guard with `validateResumeState(events)`. This is how "clinician approves the discharge letter" is implemented.
- **Context renderers** decide what the model sees: `app.context.system(text | ({state}) => text)`, `.user(...)`, `.history({scope: 'direct'|'all'|'invocation'|'ancestors'|'agent'})`, `.selectRecent(n)`, `.pruneReasoning()`, `.limitTools([...])`, `.toolChoice('required'|...)`, or `app.context(fn)` for anything. Renderers are sync; fetch data in a step/tool and put it in state.
- **Structured output**: `output: { schema: ZodObject, key?: 'stateKey', mode?: 'native'|'prompt' }` → `run.output.value` typed; parser repairs messy JSON; failure throws `OutputParseError` (match on `error.name`). One-shot: `await app.ask(prompt, { schema, system, model })` (no tools, fresh session; retries parse errors twice). `fanout(thunks, {limit})` for bounded concurrency (rejections → null).
- **Handoffs inside a run**: `ctx.run(agent, msg)` (await), `ctx.spawn` (handle), `ctx.dispatch` (fire-and-forget), or return a runnable from a tool/step (transfer). Wrappers `gated(runnable, check)` and `cached(runnable, {key, scope, ttlMs})`.
- **Hooks** (guardrails): `hooks: [{ beforeAgent, afterTool, … }]` on app/handler; `beforeAgent` returning a string short-circuits the model.
- **Stores**: default in-memory; `sqliteStore('./data/x.db')` from `/stores/sqlite` (needs `better-sqlite3`) for durable pauses. `app.run` does not persist — `await app.sessions.commit(session)`; `app.handler.rest/turn/agui` commit per turn.
- **Serving**: `app.handler.rest({agent, response:{state,usage,events}})` → `(input:{sessionId?, input:{message?|tools?|state?}}) => RestResponse`; `app.handler.turn` streams events (async iterable) — use for SSE to the UI; `app.handler.agui` speaks AG-UI over SSE.

## Testing without a model (`@animahealth/adk/testing`)

```ts
import { runTest, user, model, input, mockAgent, MockAdapter, getToolCalls, getToolResults, getLastAssistantText, findEventsByType } from '@animahealth/adk/testing'
const r = await runTest(agent, [
  user('…'),
  model({ toolCalls: [{ name: 'read_chart', args: { patientId: 'SIM-000008' } }] }), // tool really executes
  model('final text'),
], { initialState: { session: {...} } })
r.status; r.events; r.output; getToolCalls(r.events)
```

`runTest` scripts only the model (openai/gemini providers); tools, state, context run for real. `input({ tool_name: {...} })` answers a yield. `MockAdapter({responses, defaultResponse})` + `adk({adapters:{openai: mock}})` runs the real `app.run` path offline; `mock.setResponses`, `mock.reset()`, `mock.addResponses('agent:<name>', [...])` per agent; `mock.stepCalls` records rendered contexts. Vitest matchers via `await setupAdkMatchers()`.

## Evals (`app.evaluate`, helpers in `@animahealth/adk/eval`)

```ts
const cases = app.evaluate.cases([{ name, runnable, input, toolMocks: { sim_action: { execute: (args, ctx) => ({ ok: true }) }, read_chart: readChart /* passthrough */ }, metrics: [...] , retries?, timeout? }])
const metric = app.evaluate.metric({ name: 'letter_has_all_sections', evaluate: (run) => ({ passed, score?, evidence?: string[] }) })
const result = await app.evaluate(cases, { metrics: [invariants], concurrency: 8, repeat: 3, onCase })
const md = app.evaluate.report({ title })(result)   // markdown; result.summary {total, passed, failed, errors, terminated, aborted, timedOut}; per-case usage/cost
```

Builders: `eventCountMetric({eventType, filter, assertion})`, `eventSequenceMetric({sequence:[{eventType, filter}]})`, `stateMetric({scope, key, assertion})`, `timingMetric({measure: 'total_duration'|'time_to_first_tool_call'|…, assertion})`. `toolMocks` is strict: a called tool without an entry errors inside the tool. `app.simulate(agent, { input, userAgent, toolAgents, maxTurns, maxDuration, stateMatches })` drives multi-turn conversations with a simulated user. `evaluate` never throws on failure — read `summary` and exit non-zero yourself.

## Gotchas

- Text-agent context renderers must be synchronous.
- `ctx.run` rejects a delegate that yields; put yielding tools on the parent agent.
- `output.text` of a container is the last assistant event in the session; pass values between children via `ctx.state`, not return values.
- `app.ask` needs `opts.model` or `adk({ defaultModel })`.
- Descriptor names in docs (`gpt-5.6-luna`) are real on our key.
