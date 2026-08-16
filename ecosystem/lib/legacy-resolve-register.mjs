// Registers ./legacy-resolve.mjs. Passed as `--import` to each sweep arm so the
// hook is live before the library build is imported.
import { register } from 'node:module'

register('./legacy-resolve.mjs', import.meta.url)
