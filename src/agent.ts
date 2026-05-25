import Anthropic from '@anthropic-ai/sdk'
import { toolDefinitions, executeTool, type ToolContext } from './tools.js'

const MAX_ITERATIONS = 20

export interface AgentEvent {
  type: 'goal_start' | 'assertion' | 'step' | 'goal_done' | 'error'
  goal?: string
  goalIndex?: number
  passed?: boolean
  message?: string
  summary?: string
  iterations?: number
}

export interface AgentResult {
  target: string
  goal: string
  passed: boolean
  assertions: Array<{ passed: boolean; message: string }>
  summary: string
  iterations: number
}

export async function runGoal(
  client: Anthropic,
  ctx: ToolContext,
  target: string,
  baseUrl: string,
  goal: string,
  goalIndex: number,
  onEvent?: (e: AgentEvent) => void,
): Promise<AgentResult> {
  const assertions: Array<{ passed: boolean; message: string }> = []
  const messages: Anthropic.MessageParam[] = []

  onEvent?.({ type: 'goal_start', goal, goalIndex })

  const systemPrompt = `You are an autonomous QA agent testing web applications.

Target app: ${target}
Base URL: ${baseUrl}

Your current test goal: "${goal}"

Instructions:
- After navigating, ALWAYS call get_page_info() first — it gives you exact input selectors, button text, and headings so you know what to interact with
- Use the selectors from get_page_info() in fill() and click() calls — do not guess selectors
- Use get_text() to read results after form submission
- NEVER use screenshot() — it is extremely expensive. Use get_page_info() and get_text() instead.
- Use assert() to record specific checks with what you actually found (e.g. "Monthly payment shows $2,029 which is in range $1,000–$5,000")
- When you have fully tested the goal, call done() with a summary
- If something is broken, use assert(passed=false, message="what went wrong")
- Max ${MAX_ITERATIONS} steps — be efficient`

  messages.push({
    role: 'user',
    content: `Begin testing goal: "${goal}". Start by navigating to ${baseUrl} then proceed.`,
  })

  let iterations = 0
  let finalSummary = ''

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    if (toolUses.length === 0 || response.stop_reason === 'end_turn') break

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    let isDone = false
    let doneSummary = ''

    for (const tu of toolUses) {
      const prevAssertionCount = assertions.length

      const { result, done, summary } = await executeTool(
        ctx,
        tu.name,
        tu.input as Record<string, unknown>,
        assertions,
      )

      // Emit any new assertions — include goalIndex so UI routes to the right card
      for (let i = prevAssertionCount; i < assertions.length; i++) {
        onEvent?.({ type: 'assertion', passed: assertions[i].passed, message: assertions[i].message, goalIndex })
      }

      if (tu.name !== 'screenshot' && tu.name !== 'assert' && tu.name !== 'done') {
        onEvent?.({ type: 'step', message: `${tu.name}: ${JSON.stringify(tu.input).slice(0, 80)}`, goalIndex })
      }

      const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = result.map(r => {
        if (r.type === 'text') return { type: 'text' as const, text: r.text }
        return { type: 'image' as const, source: r.source }
      })

      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content })

      if (done) {
        isDone = true
        doneSummary = summary ?? ''
      }
    }

    messages.push({ role: 'user', content: toolResults })

    // Prune screenshots from history — replace with placeholder so they don't
    // get resent on every subsequent API call (major token savings)
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content as Anthropic.ToolResultBlockParam[]) {
        if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue
        block.content = (block.content as Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>).map(b =>
          b.type === 'image' ? { type: 'text' as const, text: '[screenshot]' } : b,
        )
      }
    }

    if (isDone) {
      finalSummary = doneSummary
      break
    }
  }

  const allPassed = assertions.length > 0 && assertions.every(a => a.passed)

  onEvent?.({ type: 'goal_done', passed: allPassed, summary: finalSummary, iterations, goalIndex })

  return {
    target,
    goal,
    passed: allPassed,
    assertions,
    summary: finalSummary || `Completed in ${iterations} steps`,
    iterations,
  }
}
