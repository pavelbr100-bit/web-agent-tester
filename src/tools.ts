import { chromium, type Browser, type Page } from 'playwright'
import type Anthropic from '@anthropic-ai/sdk'

export interface ToolContext {
  browser: Browser
  page: Page
}

export type ToolResult = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }

export async function createBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true })
}

export async function createPage(browser: Browser): Promise<ToolContext> {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  return { browser, page }
}

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description: 'Navigate to a URL',
    input_schema: {
      type: 'object' as const,
      properties: { url: { type: 'string', description: 'The URL to navigate to' } },
      required: ['url'],
    },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current page and return it as an image so you can see what is on screen',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'click',
    description: 'Click an element on the page. Provide a CSS selector or visible text label.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector or visible text (e.g. "button:has-text(\'Calculate\')" or "#submit-btn")' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'fill',
    description: 'Clear and type text into an input field',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input' },
        value: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'select',
    description: 'Select an option from a <select> dropdown by its visible text or value',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector for the <select> element' },
        value: { type: 'string', description: 'Option value or label to select' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'get_text',
    description: 'Extract visible text content from the page or a specific element',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to extract text from. Omit to get full page text.' },
      },
      required: [],
    },
  },
  {
    name: 'assert',
    description: 'Record a test assertion — pass or fail — with a human-readable message',
    input_schema: {
      type: 'object' as const,
      properties: {
        passed: { type: 'boolean', description: 'Whether the assertion passed' },
        message: { type: 'string', description: 'Description of what was checked' },
      },
      required: ['passed', 'message'],
    },
  },
  {
    name: 'done',
    description: 'Signal that all test goals have been completed',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Brief summary of what was tested and the overall result' },
      },
      required: ['summary'],
    },
  },
]

export async function executeTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
  assertions: Array<{ passed: boolean; message: string }>,
): Promise<{ result: ToolResult[]; done: boolean; summary?: string }> {
  const { page } = ctx

  switch (name) {
    case 'navigate': {
      await page.goto(input.url as string, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1000)
      return { result: [{ type: 'text', text: `Navigated to ${input.url}` }], done: false }
    }

    case 'screenshot': {
      const buf = await page.screenshot({ type: 'png' })
      return {
        result: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') } }],
        done: false,
      }
    }

    case 'click': {
      const sel = input.selector as string
      try {
        // Try CSS selector first, then text
        const loc = page.locator(sel).first()
        await loc.waitFor({ timeout: 5000 })
        await loc.click()
      } catch {
        await page.getByText(sel, { exact: false }).first().click()
      }
      await page.waitForTimeout(500)
      return { result: [{ type: 'text', text: `Clicked: ${input.selector}` }], done: false }
    }

    case 'fill': {
      await page.locator(input.selector as string).first().fill(input.value as string)
      return { result: [{ type: 'text', text: `Filled "${input.selector}" with "${input.value}"` }], done: false }
    }

    case 'select': {
      await page.locator(input.selector as string).first().selectOption(input.value as string)
      return { result: [{ type: 'text', text: `Selected "${input.value}" in "${input.selector}"` }], done: false }
    }

    case 'get_text': {
      const text = input.selector
        ? await page.locator(input.selector as string).first().innerText()
        : await page.evaluate(() => document.body.innerText)
      return { result: [{ type: 'text', text: text.slice(0, 4000) }], done: false }
    }

    case 'assert': {
      const a = { passed: input.passed as boolean, message: input.message as string }
      assertions.push(a)
      const icon = a.passed ? '✓' : '✗'
      return { result: [{ type: 'text', text: `${icon} ${a.message}` }], done: false }
    }

    case 'done': {
      return { result: [{ type: 'text', text: 'Done.' }], done: true, summary: input.summary as string }
    }

    default:
      return { result: [{ type: 'text', text: `Unknown tool: ${name}` }], done: false }
  }
}
