import { chromium, type Browser, type Page } from 'playwright'
import type OpenAI from 'openai'

export interface ToolContext {
  browser: Browser
  page: Page
}

export type ToolResult =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }

export async function createBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true })
}

export async function createPage(browser: Browser): Promise<ToolContext> {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1024, height: 600 })
  return { browser, page }
}

export const toolDefinitions: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a URL and wait for the page to fully load including JavaScript',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The URL to navigate to' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_info',
      description: 'Get a structured summary of the current page: title, headings, all input fields with their CSS selectors and labels, buttons, and visible text. Always call this after navigating before interacting with anything.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an element. Use exact visible button/link text or a CSS selector from get_page_info.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Visible text label or CSS selector' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill',
      description: 'Clear and type text into an input field. Use the CSS selector from get_page_info.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the input (from get_page_info)' },
          value: { type: 'string', description: 'Text to type' },
        },
        required: ['selector', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select',
      description: 'Select an option from a <select> dropdown',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the <select> element' },
          value: { type: 'string', description: 'Option value or visible label to select' },
        },
        required: ['selector', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_text',
      description: 'Get visible text from the page or a specific element. Use for reading results after form submission.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector. Omit to get full page text.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assert',
      description: 'Record a test assertion — pass or fail',
      parameters: {
        type: 'object',
        properties: {
          passed: { type: 'boolean', description: 'Whether the assertion passed' },
          message: { type: 'string', description: 'What was checked and what was found' },
        },
        required: ['passed', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Signal that all test goals are complete',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of results' },
        },
        required: ['summary'],
      },
    },
  },
]

export async function executeTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
  assertions: Array<{ passed: boolean; message: string }>,
): Promise<{ result: string; done: boolean; summary?: string }> {
  const { page } = ctx

  switch (name) {
    case 'navigate': {
      await page.goto(input.url as string, { waitUntil: 'networkidle', timeout: 30000 })
      return { result: `Navigated to ${input.url}`, done: false }
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
          const label =
            document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ??
            input.closest('label')?.textContent?.trim() ??
            input.getAttribute('placeholder') ??
            input.getAttribute('aria-label') ??
            ''
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
        `Inputs (use these selectors):\n${info.inputs.map(i => `  ${i}`).join('\n')}`,
        `Buttons:\n  ${info.buttons.join(', ')}`,
      ].join('\n\n')

      return { result: text.slice(0, 5000), done: false }
    }

    case 'click': {
      const sel = input.selector as string
      // If model passes a URL path or full URL, navigate instead of click
      if (sel.startsWith('http://') || sel.startsWith('https://') || sel.startsWith('/')) {
        const url = sel.startsWith('/') ? `${new URL(page.url()).origin}${sel}` : sel
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
        return { result: `Navigated to ${url} (redirected from click)`, done: false }
      }
      try {
        const loc = page.locator(sel).first()
        await loc.waitFor({ timeout: 5000 })
        await loc.click()
      } catch {
        await page.getByText(sel, { exact: false }).first().click()
      }
      await page.waitForTimeout(300)
      return { result: `Clicked: ${sel}`, done: false }
    }

    case 'fill': {
      const sel = input.selector as string
      const loc = page.locator(sel).first()
      await loc.waitFor({ timeout: 5000 })
      await loc.fill(input.value as string)
      return { result: `Filled "${sel}" with "${input.value}"`, done: false }
    }

    case 'select': {
      await page.locator(input.selector as string).first().selectOption(input.value as string)
      return { result: `Selected "${input.value}" in "${input.selector}"`, done: false }
    }

    case 'get_text': {
      const text = input.selector
        ? await page.locator(input.selector as string).first().innerText()
        : await page.evaluate(() => document.body.innerText)
      return { result: text.slice(0, 4000), done: false }
    }

    case 'assert': {
      const a = { passed: input.passed as boolean, message: input.message as string }
      assertions.push(a)
      return { result: `${a.passed ? '✓' : '✗'} ${a.message}`, done: false }
    }

    case 'done': {
      return { result: 'Done.', done: true, summary: input.summary as string }
    }

    default:
      return { result: `Unknown tool: ${name}`, done: false }
  }
}
