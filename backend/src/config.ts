import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const SIM_ORIGIN = process.env.SIM_ORIGIN ?? 'https://sim.animahacks.com'

/** Team key for the main world (browse it in the portals). */
export const SIM_API = process.env.SIM_API ?? ''

/** The ADK's OpenAI adapter reads OPENAI_API_KEY; our environment provides OPENAI_KEY. */
if (!process.env.OPENAI_API_KEY && process.env.OPENAI_KEY) process.env.OPENAI_API_KEY = process.env.OPENAI_KEY

export interface WorldRecord { teamName: string; apiKey: string; world: string }
export interface WorldsFile { suffix: string; createdAt: string; baseline: WorldRecord; agent: WorldRecord }

export const WORLDS_PATH = resolve(process.cwd(), '.worlds.json')

export function loadWorlds(): WorldsFile | null {
  if (!existsSync(WORLDS_PATH)) return null
  return JSON.parse(readFileSync(WORLDS_PATH, 'utf8')) as WorldsFile
}
