import { expect, test } from '@playwright/test'
import { dismissOnboarding, prepareSeedPage } from './journey'

test('configured host proceeds without an onboarding timeout', async ({ page }) => {
  await page.setContent('<button>New Session<kbd>⌥⌘N</kbd></button>')
  const started = Date.now()
  await dismissOnboarding(page)
  expect(Date.now() - started).toBeLessThan(4_000)
})

test('configured host can start with the sidebar collapsed', async ({ page }) => {
  await page.setContent('<button aria-label="Open sidebar"></button>')
  await dismissOnboarding(page)
})

test('visible onboarding is dismissed before using the shell', async ({ page }) => {
  await page.setContent(`<button>New Session</button><div class="setup_mask_pending"></div>
    <script>document.querySelector('div').innerHTML = '<button onclick="this.parentElement.remove()">Configure later</button>'</script>`)
  await dismissOnboarding(page)
  await expect(page.locator('div')).toHaveCount(0)
})

test('disabled onboarding can finish automatically', async ({ page }) => {
  await page.setContent(`<button>新会话</button><div class="setup_mask_pending"><button disabled>继续</button></div>
    <script>setTimeout(() => document.querySelector('div').remove(), 250)</script>`)
  await dismissOnboarding(page)
  await expect(page.getByRole('button', { name: '继续' })).toHaveCount(0)
})

test('session readiness handles onboarding that appears after the shell', async ({ page }) => {
  const previous = process.env.DSH_E2E_SEED_SESSION
  process.env.DSH_E2E_SEED_SESSION = 'late-onboarding'
  try {
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
      <div id="root"><button>New Session</button><div role="treeitem" data-row-key="session:late-onboarding"></div></div>
      <script>
        setTimeout(() => {
          const mask = document.createElement('div')
          mask.className = 'setup_mask_pending'
          mask.style = 'position:fixed;inset:0;z-index:100;background:white'
          mask.innerHTML = '<button onclick="this.parentElement.remove()">Continue</button>'
          document.body.append(mask)
        }, 100)
        setTimeout(() => {
          const title = document.createElement('span')
          title.textContent = 'Side chat plugin review'
          title.onclick = () => {
            const view = document.createElement('div')
            view.dataset.conversationSession = 'late-onboarding'
            view.innerHTML = '<div data-chat-flow-kind="assistant-step">full history snapshot</div>'
            document.getElementById('root').append(view)
          }
          document.querySelector('[role="treeitem"]').append(title)
        }, 250)
      </script>` }))
    await prepareSeedPage(page)
    await expect(page.locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', 'late-onboarding')
    await expect(page.locator('[class*="_mask_"]')).toHaveCount(0)
  } finally {
    if (previous === undefined) delete process.env.DSH_E2E_SEED_SESSION
    else process.env.DSH_E2E_SEED_SESSION = previous
  }
})
