import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import { createBrowser } from './tools.js'
import { runGoal, type AgentResult } from './agent.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function loadTarget(name: string) {
  const mod = await import(`../targets/${name}.js`)
  return mod.default as { name: string; baseUrl: string; goals: string[] }
}

async function main() {
  const targetName = process.argv[2]

  if (!targetName) {
    console.error('Usage: npm run run <target-name>')
    console.error('Example: npm run run:finwiser')
    process.exit(1)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY in environment')
    process.exit(1)
  }

  const target = await loadTarget(targetName)
  console.log(`\n🤖 web-agent-tester — ${target.name}`)
  console.log(`📍 ${target.baseUrl}`)
  console.log(`🎯 ${target.goals.length} goal(s)\n`)

  const client = new Anthropic({ apiKey })
  const ctx = await createBrowser()

  const results: AgentResult[] = []

  for (let i = 0; i < target.goals.length; i++) {
    const goal = target.goals[i]
    console.log(`─── Goal ${i + 1}/${target.goals.length}: ${goal}`)

    try {
      const result = await runGoal(client, ctx, target.name, target.baseUrl, goal)
      results.push(result)

      const icon = result.passed ? '✅' : '❌'
      console.log(`${icon} ${result.passed ? 'PASSED' : 'FAILED'} (${result.iterations} steps)`)
      for (const a of result.assertions) {
        console.log(`   ${a.passed ? '✓' : '✗'} ${a.message}`)
      }
      if (result.summary) console.log(`   → ${result.summary}`)
    } catch (err) {
      console.error(`   Error: ${err}`)
      results.push({
        target: target.name,
        goal,
        passed: false,
        assertions: [],
        summary: `Error: ${err}`,
        iterations: 0,
      })
    }

    console.log()
  }

  await ctx.browser.close()

  // Summary
  const passed = results.filter(r => r.passed).length
  const total = results.length
  console.log(`═══════════════════════════════`)
  console.log(`Results: ${passed}/${total} goals passed`)

  // Write JSON report
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportDir = join(__dirname, '..', 'reports')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `${targetName}-${ts}.json`)
  writeFileSync(reportPath, JSON.stringify({ target: target.name, baseUrl: target.baseUrl, results, timestamp: new Date().toISOString() }, null, 2))
  console.log(`📄 Report saved: ${reportPath}`)

  process.exit(passed === total ? 0 : 1)
}

main()
