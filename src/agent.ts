import OpenAI from 'openai'
import { toolDefinitions, executeTool, type ToolContext } from './tools.js'

const MAX_ITERATIONS = 20
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b'

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

export function createClient(): OpenAI {
  return new OpenAI({
    baseURL: process.env.OLLAMA_HOST ?? 'http://localhost:11434/v1',
    apiKey: 'ollama', // required by SDK but not used by Ollama
  })
}

export async function runGoal(
  client: OpenAI,
  ctx: ToolContext,
  target: string,
  baseUrl: string,
  goal: string,
  goalIndex: number,
  onEvent?: (e: AgentEvent) => void,
): Promise<AgentResult> {
  const assertions: Array<{ passed: boolean; message: string }> = []
  const messages: OpenAI.ChatCompletionMessageParam[] = []

  onEvent?.({ type: 'goal_start', goal, goalIndex })

  const systemPrompt = `You are an autonomous QA agent testing web applications.

Target app: ${target}
Base URL: ${baseUrl}

Your current test goal: "${goal}"

Instructions:
- After navigating, ALWAYS call get_page_info() first — copy selectors EXACTLY as shown, do not add or change anything
- Use get_text() to read results after interactions
- NEVER use screenshot()
- You MUST call assert() for every check — a test with zero assert() calls automatically FAILS
- You MUST call assert() at least once before calling done()
- Call done() only after asserting — never call done() as your first or only action
- If something is broken, call assert(passed=false, message="exact error found")
- Max ${MAX_ITERATIONS} steps`

  messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: `Begin testing goal: "${goal}". Start by navigating to ${baseUrl} then proceed.` })

  let iterations = 0
  let finalSummary = ''

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await client.chat.completions.create({
      model: OLLAMA_MODEL,
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
    })

    const msg = response.choices[0].message
    messages.push(msg)

    const toolCalls = msg.tool_calls ?? []
    const finishReason = response.choices[0].finish_reason

    // Log what the model returned so we can debug failures
    onEvent?.({ type: 'step', message: `model response: finish=${finishReason} tools=${toolCalls.length} text=${(msg.content ?? '').slice(0, 60)}`, goalIndex })

    // If model responded with text only (no tool calls), nudge it back on track
    if (toolCalls.length === 0) {
      if (finishReason === 'stop' && msg.content) {
        // Model finished without calling done() — treat as implicit completion with no assertions
        onEvent?.({ type: 'step', message: `model stopped without tool calls: ${msg.content.slice(0, 120)}`, goalIndex })
        break
      }
      break
    }

    let isDone = false
    let doneSummary = ''

    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue
      const name = tc.function.name
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(tc.function.arguments || '{}')
      } catch {
        onEvent?.({ type: 'step', message: `malformed tool args for ${name}: ${tc.function.arguments}`, goalIndex })
      }

      const prevAssertionCount = assertions.length
      const { result, done, summary } = await executeTool(ctx, name, input, assertions)

      // Emit new assertions with goalIndex
      for (let i = prevAssertionCount; i < assertions.length; i++) {
        onEvent?.({ type: 'assertion', passed: assertions[i].passed, message: assertions[i].message, goalIndex })
      }

      if (name !== 'assert' && name !== 'done') {
        onEvent?.({ type: 'step', message: `${name}: ${JSON.stringify(input).slice(0, 80)}`, goalIndex })
      }

      // Add tool result to messages
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })

      if (done) {
        // If model called done() without any assertions, record a failure
        if (assertions.length === 0) {
          assertions.push({ passed: false, message: 'No assertions were made — model called done() without verifying anything' })
          onEvent?.({ type: 'assertion', passed: false, message: assertions[assertions.length - 1].message, goalIndex })
        }
        isDone = true
        doneSummary = summary ?? ''
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
