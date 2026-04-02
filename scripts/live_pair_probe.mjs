import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });

try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4200/pair', {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  const status = await page
    .$eval('.status-text', (element) => element.textContent?.trim() ?? '')
    .catch(() => null);
  const error = await page
    .$eval('.error-message', (element) => element.textContent?.trim() ?? '')
    .catch(() => null);
  const hasQr = (await page.$('.qr-image')) !== null;
  const pageText = await page.evaluate(() => document.body.innerText);

  console.log(
    JSON.stringify(
      {
        url: page.url(),
        status,
        error,
        hasQr,
        pageText,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}