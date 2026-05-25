import 'dotenv/config'
import { createBrowser, createPage } from './tools.js'
import { createClient, runGoal, type AgentResult, type AgentEvent } from './agent.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function loadTarget(name: string) {
  const mod = await import(`../targets/${name}.js`)
  return mod.default as { name: string; baseUrl: string; goals: string[] }
}

export async function runTarget(
  targetName: string,
  onEvent?: (e: AgentEvent & { type: string }) => void,
): Promise<AgentResult[]> {
  const target = await loadTarget(targetName)
  const client = createClient()
  const browser = await createBrowser()

  const results = await Promise.all(
    target.goals.map(async (goal, i) => {
      const ctx = await createPage(browser)
      try {
        return await runGoal(client, ctx, target.name, target.baseUrl, goal, i, onEvent)
      } catch (err) {
        onEvent?.({ type: 'error', message: String(err), goalIndex: i })
        return {
          target: target.name,
          goal,
          passed: false,
          assertions: [],
          summary: `Error: ${err}`,
          iterations: 0,
        } satisfies AgentResult
      } finally {
        await ctx.page.close()
      }
    }),
  )

  await browser.close()

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = join(__dirname, '..', 'reports')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `${targetName}-${ts}.json`)
  writeFileSync(
    reportPath,
    JSON.stringify({ target: target.name, baseUrl: target.baseUrl, results, timestamp: new Date().toISOString() }, null, 2),
  )

  return results
}

async function main() {
  const targetName = process.argv[2]
  if (!targetName) { console.error('Usage: npm run run <target-name>'); process.exit(1) }

  const target = await loadTarget(targetName)
  console.log(`\n🤖 web-agent-tester — ${target.name}\n📍 ${target.baseUrl}\n🎯 ${target.goals.length} goals (parallel, Ollama)\n`)

  const results = await runTarget(targetName, (e) => {
    const prefix = `[Goal ${(e.goalIndex ?? 0) + 1}]`
    if (e.type === 'goal_start') console.log(`${prefix} Starting: ${e.goal}`)
    if (e.type === 'assertion') console.log(`${prefix}   ${e.passed ? '✓' : '✗'} ${e.message}`)
    if (e.type === 'goal_done') console.log(`${prefix} ${e.passed ? '✅ PASSED' : '❌ FAILED'} (${e.iterations} steps)`)
    if (e.type === 'error') console.error(`${prefix} Error: ${e.message}`)
  })

  const passed = results.filter(r => r.passed).length
  console.log(`\n═══════════════════════════════\nResults: ${passed}/${results.length} goals passed`)
  process.exit(passed === results.length ? 0 : 1)
}

const isMain = process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')
if (isMain) main()
