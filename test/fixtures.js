import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// import.meta.url is not a file: URL under jsdom, so resolve from the project root
export const fixture = (name) => readFileSync(join(process.cwd(), 'test/fixtures', name), 'utf8')
