import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadTarget, runTarget } from './runner.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 4242

app.use(cors())
app.use(express.json())
app.use(express.static(join(__dirname, '..', 'ui')))

// List available targets
app.get('/api/targets', async (_req, res) => {
  const targetsDir = join(__dirname, '..', 'targets')
  try {
    const files = readdirSync(targetsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'))
    const targets = await Promise.all(
      files.map(async f => {
        const name = f.replace(/\.(ts|js)$/, '')
        try {
          const t = await loadTarget(name)
          return { name, label: t.name, baseUrl: t.baseUrl, goalCount: t.goals.length }
        } catch {
          return { name, label: name, baseUrl: '', goalCount: 0 }
        }
      }),
    )
    res.json(targets)
  } catch {
    res.json([])
  }
})

// SSE stream: run a target and stream events
app.get('/api/run/:target', async (req, res) => {
  const targetName = req.params.target

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const target = await loadTarget(targetName)
    send({ type: 'start', target: target.name, baseUrl: target.baseUrl, goalCount: target.goals.length, goals: target.goals })

    const results = await runTarget(targetName, (e) => send(e))

    const passed = results.filter(r => r.passed).length
    send({ type: 'run_done', passed, failed: results.length - passed, total: results.length, results })
  } catch (err) {
    send({ type: 'fatal_error', message: String(err) })
  } finally {
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`\n🤖 web-agent-tester UI running at http://localhost:${PORT}\n`)
})
