import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { createBrowser } from './tools.js'
import { runGoal, type AgentResult } from './agent.js'
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
  onEvent?: (e: import('./agent.js').AgentEvent & { type: string }) => void,
): Promise<AgentResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY')

  const target = await loadTarget(targetName)
  const client = new Anthropic({ apiKey })
  const ctx = await createBrowser()
  const results: AgentResult[] = []

  for (let i = 0; i < target.goals.length; i++) {
    try {
      const result = await runGoal(client, ctx, target.name, target.baseUrl, target.goals[i], i, onEvent)
      results.push(result)
    } catch (err) {
      onEvent?.({ type: 'error', message: String(err), goalIndex: i })
      results.push({ target: target.name, goal: target.goals[i], passed: false, assertions: [], summary: `Error: ${err}`, iterations: 0 })
    }
  }

  await ctx.browser.close()

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = join(__dirname, '..', 'reports')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `${targetName}-${ts}.json`)
  writeFileSync(reportPath, JSON.stringify({ target: target.name, baseUrl: target.baseUrl, results, timestamp: new Date().toISOString() }, null, 2))

  return results
}

// CLI entry point
async function main() {
  const targetName = process.argv[2]
  if (!targetName) { console.error('Usage: npm run run <target-name>'); process.exit(1) }

  const target = await loadTarget(targetName)
  console.log(`\n🤖 web-agent-tester — ${target.name}\n📍 ${target.baseUrl}\n🎯 ${target.goals.length} goal(s)\n`)

  const results = await runTarget(targetName, (e) => {
    if (e.type === 'goal_start') console.log(`─── Goal ${(e.goalIndex ?? 0) + 1}: ${e.goal}`)
    if (e.type === 'assertion') console.log(`   ${e.passed ? '✓' : '✗'} ${e.message}`)
    if (e.type === 'goal_done') console.log(`${e.passed ? '✅' : '❌'} ${e.passed ? 'PASSED' : 'FAILED'} (${e.iterations} steps)\n`)
    if (e.type === 'error') console.error(`   Error: ${e.message}`)
  })

  const passed = results.filter(r => r.passed).length
  console.log(`═══════════════════════════════\nResults: ${passed}/${results.length} goals passed`)
  process.exit(passed === results.length ? 0 : 1)
}

// Only run CLI when executed directly, not when imported by server.ts
const isMain = process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')
if (isMain) main()
