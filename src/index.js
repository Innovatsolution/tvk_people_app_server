import { app } from './app.js'
import { env } from './config/env.js'

app.listen(env.port, () => {
  console.log(`TVK complaint API listening on http://localhost:${env.port}`)
  console.log(`CORS allowed origin: ${env.corsOrigin}`)
})
