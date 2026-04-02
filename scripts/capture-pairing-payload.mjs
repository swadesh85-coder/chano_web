import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const runDir = process.argv[2];
const targetUrl = process.argv[3] ?? 'http://127.0.0.1:4200/pair?relayUrl=ws%3A%2F%2F127.0.0.1%3A8080%2Frelay&qrRelayUrl=ws%3A%2F%2F10.0.2.2%3A8080%2Frelay';

if (!runDir) {
  throw new Error('Run directory argument is required.');
}

fs.mkdirSync(runDir, { recursive: true });
const logPath = path.join(runDir, 'web.log');
const payloadPath = path.join(runDir, 'pairing-payload.json');
const statePath = path.join(runDir, 'web-state.json');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

const writeLog = (kind, detail) => {
  const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
  const line = `[${new Date().toISOString()}] ${kind} ${message}`;
  logStream.write(`${line}\n`);
  console.log(line);
};

let payloadWritten = false;
let lastStatus = '';
let lastUrl = '';

const browser = await puppeteer.launch({
  headless: true,
  defaultViewport: { width: 1440, height: 1200 },
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
page.on('console', async (msg) => {
  const values = await Promise.all(
    msg.args().map(async (arg) => {
      try {
        return await arg.jsonValue();
      } catch {
        return String(arg);
      }
    }),
  );

  writeLog('console', { type: msg.type(), text: msg.text(), values });

  if (!payloadWritten && values[0] === 'PAIRING_QR_PAYLOAD' && values[1] && typeof values[1] === 'object') {
    fs.writeFileSync(payloadPath, `${JSON.stringify(values[1], null, 2)}\n`);
    payloadWritten = true;
    writeLog('payload', values[1]);
  }
});
page.on('pageerror', (error) => writeLog('pageerror', error.stack ?? error.message));
page.on('requestfailed', (request) =>
  writeLog('requestfailed', {
    url: request.url(),
    method: request.method(),
    failure: request.failure()?.errorText ?? 'unknown',
  }),
);
page.on('response', (response) => {
  if (response.status() >= 400) {
    writeLog('response', { url: response.url(), status: response.status() });
  }
});

await page.goto(targetUrl, { waitUntil: 'networkidle2' });
writeLog('navigation', { url: page.url(), title: await page.title() });
await page.waitForSelector('.status-text', { timeout: 15000 });

const captureState = async () => {
  const state = await page.evaluate(() => {
    const statusText = document.querySelector('.status-text')?.textContent?.trim() ?? null;
    const qrVisible = Boolean(document.querySelector('.qr-image'));
    return {
      statusText,
      qrVisible,
      url: window.location.href,
      capturedAt: new Date().toISOString(),
    };
  });

  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  if (state.statusText && state.statusText !== lastStatus) {
    lastStatus = state.statusText;
    writeLog('status', state.statusText);
  }

  if (state.url !== lastUrl) {
    lastUrl = state.url;
    writeLog('url', state.url);
  }
};

await captureState();
setInterval(captureState, 2000);
setInterval(() => writeLog('heartbeat', 'browser session still active'), 30000);

const shutdown = async (signal) => {
  writeLog('shutdown', signal);
  await browser.close();
  logStream.end();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
