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
  await page.setViewportSize({ width: 1024, height: 600 })
  return { browser, page }
}

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description: 'Navigate to a URL and wait for the page to fully load including JavaScript',
    input_schema: {
      type: 'object' as const,
      properties: { url: { type: 'string', description: 'The URL to navigate to' } },
      required: ['url'],
    },
  },
  {
    name: 'get_page_info',
    description: 'Get a structured summary of the current page: title, headings, all input fields (with labels/placeholders), buttons, and visible text. Use this after navigating to understand the page structure before interacting.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot — only use if the page is behaving unexpectedly and text-based tools cannot diagnose it',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'click',
    description: 'Click an element. Use exact visible button/link text (e.g. "Calculate") or a CSS selector from get_page_info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'Visible text label or CSS selector' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'fill',
    description: 'Clear and type into an input field. Use the selector from get_page_info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input (from get_page_info)' },
        value: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'select',
    description: 'Select an option from a <select> dropdown',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector for the <select> element' },
        value: { type: 'string', description: 'Option value or visible label to select' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'get_text',
    description: 'Get visible text from the page or a specific element. Use for reading results after form submission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector. Omit to get full page text.' },
      },
      required: [],
    },
  },
  {
    name: 'assert',
    description: 'Record a test assertion — pass or fail',
    input_schema: {
      type: 'object' as const,
      properties: {
        passed: { type: 'boolean', description: 'Whether the assertion passed' },
        message: { type: 'string', description: 'What was checked and what was found' },
      },
      required: ['passed', 'message'],
    },
  },
  {
    name: 'done',
    description: 'Signal that all test goals are complete',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Brief summary of results' },
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
      await page.goto(input.url as string, { waitUntil: 'networkidle', timeout: 30000 })
      return { result: [{ type: 'text', text: `Navigated to ${input.url}` }], done: false }
    }

    case 'get_page_info': {
      const info = await page.evaluate(() => {
        const title = document.title
        const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(h => `${h.tagName}: ${h.textContent?.trim()}`)

        const inputs = Array.from(document.querySelectorAll('input,textarea,select')).map(el => {
          const input = el as HTMLInputElement
          const id = input.id ? `#${input.id}` : ''
          const name = input.name ? `[name="${input.name}"]` : ''
          const selector = id || name || input.tagName.toLowerCase()
          const label = document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim()
            ?? input.closest('label')?.textContent?.trim()
            ?? input.getAttribute('placeholder')
            ?? input.getAttribute('aria-label')
            ?? ''
          return `${input.tagName.toLowerCase()}${selector} — label: "${label}", type: ${input.type ?? 'text'}, value: "${input.value}"`
        })

        const buttons = Array.from(document.querySelectorAll('button,[role="button"]'))
          .map(b => `"${b.textContent?.trim()}"`)
          .filter(b => b.length > 2)
          .slice(0, 20)

        return { title, headings, inputs, buttons }
      })

      const text = [
        `Title: ${info.title}`,
        `Headings:\n${info.headings.map(h => `  ${h}`).join('\n')}`,
        `Inputs (use these selectors for fill/select):\n${info.inputs.map(i => `  ${i}`).join('\n')}`,
        `Buttons (use exact text for click):\n  ${info.buttons.join(', ')}`,
      ].join('\n\n')

      return { result: [{ type: 'text', text: text.slice(0, 5000) }], done: false }
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
        const loc = page.locator(sel).first()
        await loc.waitFor({ timeout: 5000 })
        await loc.click()
      } catch {
        await page.getByText(sel, { exact: false }).first().click()
      }
      await page.waitForTimeout(300)
      return { result: [{ type: 'text', text: `Clicked: ${sel}` }], done: false }
    }

    case 'fill': {
      const sel = input.selector as string
      const loc = page.locator(sel).first()
      await loc.waitFor({ timeout: 5000 })
      await loc.fill(input.value as string)
      return { result: [{ type: 'text', text: `Filled "${sel}" with "${input.value}"` }], done: false }
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
      return { result: [{ type: 'text', text: `${a.passed ? '✓' : '✗'} ${a.message}` }], done: false }
    }

    case 'done': {
      return { result: [{ type: 'text', text: 'Done.' }], done: true, summary: input.summary as string }
    }

    default:
      return { result: [{ type: 'text', text: `Unknown tool: ${name}` }], done: false }
  }
}
