const { chromium } = require('playwright');
let managedBrowser;

function splitBusinessNumber(value = '') {
  const digits = String(value).replace(/\D/g, '').padEnd(10, ' ');
  return [digits.slice(0, 3).trim(), digits.slice(3, 5).trim(), digits.slice(5, 10).trim()];
}

async function fillInput(inputs, index, value) {
  await inputs.nth(index).fill(value == null ? '' : String(value));
}

async function getBrowser() {
  if (managedBrowser?.isConnected()) return { browser: managedBrowser, connected: true };
  const endpoints = [process.env.PLAYWRIGHT_CDP_URL, 'http://127.0.0.1:9222'].filter(Boolean);
  for (const endpoint of [...new Set(endpoints)]) {
    try {
      return { browser: await chromium.connectOverCDP(endpoint), connected: true };
    } catch {
      // A normally opened browser does not expose CDP. Try the next endpoint or open a new browser.
    }
  }
  managedBrowser = await chromium.launch({ headless: false, slowMo: 120, args: ['--remote-debugging-port=9222'] });
  managedBrowser.on('disconnected', () => { managedBrowser = undefined; });
  return { browser: managedBrowser, connected: false };
}

async function findOrOpenTargetPage(browser, targetUrl) {
  const targetOrigin = new URL(targetUrl).origin;
  const pages = browser.contexts().flatMap((context) => context.pages());
  let page = pages.find((candidate) => {
    try { return new URL(candidate.url()).origin === targetOrigin; } catch { return false; }
  });

  if (!page) {
    const context = browser.contexts()[0] || await browser.newContext();
    page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
  } else {
    await page.bringToFront();
    await page.waitForLoadState('domcontentloaded');
  }
  return page;
}

function numeric(value) {
  return Number(String(value || '').replace(/,/g, '')) || 0;
}

/** Values are entered only into the public mock site. No certificate, login, or issue button is used. */
async function runInvoiceFlow(targetUrl, invoice) {
  const { browser, connected } = await getBrowser();
  try {
    const page = await findOrOpenTargetPage(browser, targetUrl);
    const tables = page.locator('table');
    if (await tables.count() < 6) throw new Error('대상 사이트의 세금계산서 입력 화면을 찾지 못했어요.');

    const supplierInputs = tables.nth(1).locator('input');
    const [supplierFirst, supplierSecond, supplierThird] = splitBusinessNumber(invoice.supplierBusinessNumber);
    await fillInput(supplierInputs, 0, supplierFirst); await fillInput(supplierInputs, 1, supplierSecond); await fillInput(supplierInputs, 2, supplierThird);
    await fillInput(supplierInputs, 4, invoice.supplierName); await fillInput(supplierInputs, 5, invoice.supplierRepresentative);
    await fillInput(supplierInputs, 6, invoice.supplierPostalCode); await fillInput(supplierInputs, 7, invoice.supplierAddress);
    await fillInput(supplierInputs, 8, invoice.supplierBusinessType); await fillInput(supplierInputs, 9, invoice.supplierBusinessCategory);
    const [supplierEmailLocal = '', supplierEmailDomain = ''] = String(invoice.supplierEmail || '').split('@');
    await fillInput(supplierInputs, 10, supplierEmailLocal); await fillInput(supplierInputs, 11, supplierEmailDomain);

    const recipientInputs = tables.nth(2).locator('input');
    const [recipientFirst, recipientSecond, recipientThird] = splitBusinessNumber(invoice.recipientBusinessNumber);
    await fillInput(recipientInputs, 0, recipientFirst); await fillInput(recipientInputs, 1, recipientSecond); await fillInput(recipientInputs, 2, recipientThird);
    await fillInput(recipientInputs, 4, invoice.recipientName); await fillInput(recipientInputs, 5, invoice.recipientRepresentative);
    await fillInput(recipientInputs, 6, invoice.recipientPostalCode); await fillInput(recipientInputs, 7, invoice.recipientAddress);
    await fillInput(recipientInputs, 8, invoice.recipientBusinessType); await fillInput(recipientInputs, 9, invoice.recipientBusinessCategory);
    const [recipientEmailLocal = '', recipientEmailDomain = ''] = String(invoice.recipientEmail || '').split('@');
    await fillInput(recipientInputs, 10, recipientEmailLocal); await fillInput(recipientInputs, 11, recipientEmailDomain);

    const dateInputs = tables.nth(3).locator('input');
    await fillInput(dateInputs, 0, invoice.issueDate); await fillInput(dateInputs, 4, invoice.invoiceRemark);

    const itemInputs = tables.nth(4).locator('input');
    const issueDate = new Date(`${invoice.issueDate}T00:00:00`);
    const items = Array.isArray(invoice.items) ? invoice.items.slice(0, 4) : [];
    for (let row = 0; row < 4; row += 1) {
      const item = items[row] || {};
      const offset = row * 9;
      const amount = numeric(item.amount) || numeric(item.quantity) * numeric(item.unitPrice);
      await fillInput(itemInputs, offset, item.month || String(issueDate.getMonth() + 1).padStart(2, '0'));
      await fillInput(itemInputs, offset + 1, item.day || String(issueDate.getDate()).padStart(2, '0'));
      await fillInput(itemInputs, offset + 2, item.name); await fillInput(itemInputs, offset + 3, item.specification);
      await fillInput(itemInputs, offset + 4, item.quantity); await fillInput(itemInputs, offset + 5, item.unitPrice);
      await fillInput(itemInputs, offset + 6, amount || ''); await fillInput(itemInputs, offset + 7, item.tax || (amount ? Math.floor(amount * 0.1) : ''));
      await fillInput(itemInputs, offset + 8, item.remark);
    }

    const paymentInputs = tables.nth(5).locator('input');
    await fillInput(paymentInputs, 0, invoice.cashAmount); await fillInput(paymentInputs, 1, invoice.checkAmount);
    await fillInput(paymentInputs, 2, invoice.noteAmount); await fillInput(paymentInputs, 3, invoice.accountsReceivable);
    const claimRadioIndex = invoice.claimType === '영수' ? 5 : 4;
    if (await paymentInputs.count() > claimRadioIndex) await paymentInputs.nth(claimRadioIndex).check();
    return { ok: true, message: connected ? '이미 열려 있던 연결 가능한 Chromium 창에 내용을 입력했어요.' : '새 Chromium 창을 열어 내용을 입력했어요.' };
  } catch (error) {
    if (!connected) await browser.close();
    throw error;
  }
}

module.exports = { runInvoiceFlow };
