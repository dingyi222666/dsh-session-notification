/* Take README screenshots of the Notifications settings section in the
 * running dsh web GUI. Uses playwright-core with the system Chrome binary
 * (no browser downloads), headless with a fresh profile. */
import { chromium } from '/Users/dingyi/projects/dsh/test-dingyi222666/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'

const BASE = 'http://127.0.0.1:3080'
const OUT = '/Users/dingyi/projects/dsh/dsh-session-notification/screenshots'

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--disable-extensions'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 })

const log = (msg) => { console.log(`[shot] ${msg}`) }

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  log('goto ok')

  // Wait for the settings trigger (sidebar foot button labelled 设置).
  const trigger = page.getByRole('button', { name: '设置', exact: true }).first()
  await trigger.waitFor({ state: 'visible', timeout: 30000 })
  log('trigger visible')
  await trigger.click()

  // Wait for the settings nav and click the 通知 section.
  const navLabel = page.getByText('通知', { exact: true }).first()
  await navLabel.waitFor({ state: 'visible', timeout: 15000 })
  await navLabel.click()
  log('notifications nav clicked')

  // Wait for the section content.
  await page.getByText('浏览器通知', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/01-notifications-section.png` })
  log('section screenshot saved')

  // Open the completed row's sound picker for a second frame.
  const pickers = page.getByLabel('提示音')
  const count = await pickers.count()
  log(`sound pickers: ${count}`)
  if (count >= 2) {
    await pickers.nth(2).click() // failed row picker (0 = sound switch, 1 = completed, 2 = failed)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/02-sound-menu-open.png` })
    log('menu screenshot saved')
  }
} catch (error) {
  log(`FAILED: ${String(error)}`)
  const body = await page.locator('body').innerText().catch(() => '')
  log(`body text head: ${body.slice(0, 400)}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
