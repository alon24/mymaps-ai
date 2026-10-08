import { z } from 'zod'

/**
 * Typesafe build-time config. All values are public (they ship in the bundle).
 * Missing optional values simply disable the related feature (Drive, default Worker URL).
 */
const schema = z.object({
  VITE_WORKER_URL: z.union([z.literal(''), z.url()]).default(''),
  VITE_GOOGLE_CLIENT_ID: z.string().default(''),
  VITE_GOOGLE_API_KEY: z.string().default(''),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Invalid environment config: ${z.prettifyError(result.error)}`)
  }
  return result.data
}

export const env: Env = parseEnv(import.meta.env)

export const driveEnabled = (e: Env = env): boolean =>
  e.VITE_GOOGLE_CLIENT_ID !== '' && e.VITE_GOOGLE_API_KEY !== ''
