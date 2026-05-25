import Anthropic from '@anthropic-ai/sdk'
import { toolDefinitions, executeTool, type ToolContext, type ToolResult } from './tools.js'

const MAX_ITERATIONS = 40

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
): Promise<AgentResult> {
  const assertions: Array<{ passed: boolean; message: string }> = []
  const messages: Anthropic.MessageParam[] = []

  const systemPrompt = `You are an autonomous QA agent testing web applications.

Target app: ${target}
Base URL: ${baseUrl}

Your current test goal: "${goal}"

Instructions:
- Use the available tools to navigate the app, interact with it, and verify the goal
- Always take a screenshot after navigating or after key interactions so you can see the page
- Use assert() to record specific checks (e.g. "Monthly payment is a valid dollar amount")
- Be thorough: fill in realistic test values, submit forms, and verify results make sense
- When you have fully tested the goal, call done() with a summary
- If something is broken or unexpected, use assert(passed=false, ...) to record it
- Max ${MAX_ITERATIONS} steps — be efficient`

  // Start: take a screenshot to orient
  messages.push({
    role: 'user',
    content: `Begin testing goal: "${goal}". Start by navigating to ${baseUrl} then proceed.`,
  })

  let iterations = 0
  let finalSummary = ''

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools: toolDefinitions,
      messages,
    })

    // Add assistant message to history
    messages.push({ role: 'assistant', content: response.content })

    // Collect all tool uses in this response
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

    if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
      // No tool calls — agent decided it's done without calling done()
      break
    }

    // Execute each tool and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    let isDone = false
    let doneSummary = ''

    for (const tu of toolUses) {
      const { result, done, summary } = await executeTool(
        ctx,
        tu.name,
        tu.input as Record<string, unknown>,
        assertions,
      )

      const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = result.map(r => {
        if (r.type === 'text') return { type: 'text' as const, text: r.text }
        return {
          type: 'image' as const,
          source: r.source,
        }
      })

      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content })

      if (done) {
        isDone = true
        doneSummary = summary ?? ''
      }
    }

    messages.push({ role: 'user', content: toolResults })

    if (isDone) {
      finalSummary = doneSummary
      break
    }
  }

  const allPassed = assertions.length > 0 && assertions.every(a => a.passed)

  return {
    target,
    goal,
    passed: allPassed,
    assertions,
    summary: finalSummary || `Completed in ${iterations} steps`,
    iterations,
  }
}
