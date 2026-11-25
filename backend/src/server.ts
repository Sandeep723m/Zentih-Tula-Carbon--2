import { app } from './app.js'
import { devShortcuts, env } from './config/env.js'

if (devShortcuts) console.warn('WARNING: DEV_AUTH_SHORTCUTS is on: two-step is skipped and passwords can be reset without email. Development machines only.')

app.listen(env.PORT, () => {
  console.log(`Tula Carbon backend listening on port ${env.PORT} (${env.NODE_ENV})`)
})
