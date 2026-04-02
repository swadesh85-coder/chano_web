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
const mutationRequestPath = path.join(runDir, 'web-mutation-request.json');
const mutationResultPath = path.join(runDir, 'web-mutation-result.json');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

const writeLog = (kind, detail) => {
  const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
  const line = `[${new Date().toISOString()}] ${kind} ${message}`;
  logStream.write(`${line}\n`);
  console.log(line);
};

const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

let payloadRevision = 0;
let explorerReadyLogged = false;
let lastStatus = '';
let lastUrl = '';
let handledMutationRequestId = null;
let pendingDialogValue = null;

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

  if (values[0] === 'PAIRING_QR_PAYLOAD' && values[1] && typeof values[1] === 'object') {
    payloadRevision += 1;
    writeJson(payloadPath, values[1]);
    writeLog(payloadRevision === 1 ? 'payload' : 'payload_refresh', {
      revision: payloadRevision,
      payload: values[1],
    });
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

page.on('dialog', async (dialog) => {
  const acceptedValue = pendingDialogValue;
  writeLog('dialog', {
    type: dialog.type(),
    message: dialog.message(),
    acceptedValue,
  });

  pendingDialogValue = null;

  if (dialog.type() === 'prompt') {
    await dialog.accept(acceptedValue ?? 'smoke-rename-fallback');
    return;
  }

  await dialog.accept();
});

await page.goto(targetUrl, { waitUntil: 'networkidle2' });
writeLog('navigation', { url: page.url(), title: await page.title() });
await page.waitForSelector('.status-text', { timeout: 15000 });

const captureState = async () => {
  const state = await page.evaluate(() => {
    const statusText = document.querySelector('.status-text')?.textContent?.trim() ?? null;
    const qrVisible = Boolean(document.querySelector('.qr-image'));
    const threadRows = Array.from(document.querySelectorAll('[data-testid="thread-item"]'));
    const threadTitles = threadRows
      .slice(0, 8)
      .map((row) => row.querySelector('.content-item-row__title, [data-role="row-title"], h3, h4')?.textContent?.trim() ?? row.textContent?.trim() ?? null)
      .filter((value) => typeof value === 'string' && value.length > 0);
    const recordRows = Array.from(document.querySelectorAll('[data-testid="record-item"]'));
    const recordLabels = recordRows
      .slice(0, 12)
      .map((row) => row.textContent?.trim() ?? null)
      .filter((value) => typeof value === 'string' && value.length > 0);

    let selectedThreadId = null;
    let componentThreadTitles = [];
    let componentRecordLabels = [];
    let componentRecordBodies = [];

    const globalNg = globalThis.ng;
    if (typeof globalNg?.getComponent === 'function') {
      const explorerElement = document.querySelector('app-explorer');
      if (explorerElement instanceof Element) {
        const explorerComponent = globalNg.getComponent(explorerElement);
        if (explorerComponent) {
          selectedThreadId = typeof explorerComponent.selectedThreadId === 'function'
            ? explorerComponent.selectedThreadId()
            : null;

          const componentThreads = typeof explorerComponent.threadList === 'function'
            ? explorerComponent.threadList()
            : [];
          if (Array.isArray(componentThreads)) {
            componentThreadTitles = componentThreads
              .slice(0, 8)
              .map((thread) => typeof thread?.title === 'string' ? thread.title : null)
              .filter((value) => typeof value === 'string' && value.length > 0);
          }

          const componentRecords = typeof explorerComponent.recordList === 'function'
            ? explorerComponent.recordList()
            : [];
          if (Array.isArray(componentRecords)) {
            componentRecordLabels = componentRecords
              .slice(0, 12)
              .map((record) => {
                if (typeof record?.displayLabel === 'string' && record.displayLabel.length > 0) {
                  return record.displayLabel;
                }

                if (typeof record?.title === 'string' && record.title.length > 0) {
                  return record.title;
                }

                return null;
              })
              .filter((value) => typeof value === 'string' && value.length > 0);

            componentRecordBodies = componentRecords
              .slice(0, 12)
              .map((record) => typeof record?.content === 'string' ? record.content : null)
              .filter((value) => typeof value === 'string' && value.length > 0);
          }
        }
      }
    }

    return {
      statusText,
      qrVisible,
      url: window.location.href,
      explorerReady: window.location.pathname.includes('/explorer'),
      threadTitles,
      selectedThreadId,
      componentThreadTitles,
      recordLabels,
      componentRecordLabels,
      componentRecordBodies,
      capturedAt: new Date().toISOString(),
    };
  });

  writeJson(statePath, state);

  if (state.statusText && state.statusText !== lastStatus) {
    lastStatus = state.statusText;
    writeLog('status', state.statusText);
  }

  if (state.url !== lastUrl) {
    lastUrl = state.url;
    writeLog('url', state.url);
  }

  if (state.explorerReady && !explorerReadyLogged) {
    explorerReadyLogged = true;
    writeLog('explorer_ready', { url: state.url, threadTitles: state.threadTitles });
  }

  return state;
};

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureFirstThreadSelected = async () => {
  const selection = await page.evaluate(() => {
    const globalNg = globalThis.ng;
    if (typeof globalNg?.getComponent !== 'function') {
      return { ok: false, reason: 'angular_debug_api_unavailable' };
    }

    const explorerElement = document.querySelector('app-explorer');
    if (!(explorerElement instanceof Element)) {
      return { ok: false, reason: 'explorer_component_missing' };
    }

    const explorerComponent = globalNg.getComponent(explorerElement);
    if (!explorerComponent) {
      return { ok: false, reason: 'explorer_component_unavailable' };
    }

    if (typeof explorerComponent.selectFolder === 'function') {
      explorerComponent.selectFolder(null);
    }

    const threads = typeof explorerComponent.threadList === 'function'
      ? explorerComponent.threadList()
      : [];
    const selectedThreadId = typeof explorerComponent.selectedThreadId === 'function'
      ? explorerComponent.selectedThreadId()
      : null;
    const targetThreadId = selectedThreadId ?? (Array.isArray(threads) ? threads[0]?.id ?? null : null);

    if (typeof targetThreadId !== 'string' || targetThreadId.length === 0) {
      return {
        ok: false,
        reason: 'no_target_thread',
        selectedThreadId,
        visibleThreadCount: Array.isArray(threads) ? threads.length : null,
      };
    }

    if (selectedThreadId !== targetThreadId && typeof explorerComponent.selectThread === 'function') {
      explorerComponent.selectThread(targetThreadId);
    }

    return {
      ok: true,
      targetThreadId,
      selectedThreadId,
      visibleThreadCount: Array.isArray(threads) ? threads.length : null,
    };
  });

  writeLog('thread_selection_attempt', selection);

  if (selection?.ok !== true) {
    const rootFolderSelector = '[data-testid="folder-root"]';
    const firstThreadSelector = '[data-testid="thread-item"]';
    const hasRootFolder = await page.$(rootFolderSelector);
    if (hasRootFolder) {
      await page.click(rootFolderSelector);
    }

    await page.waitForSelector(firstThreadSelector, { timeout: 15000 });
    await page.click(firstThreadSelector);
  }

  await waitFor(400);
  return captureState();
};

const executeMutationRequest = async () => {
  if (!explorerReadyLogged || !fs.existsSync(mutationRequestPath)) {
    return;
  }

  const request = JSON.parse(fs.readFileSync(mutationRequestPath, 'utf8'));
  const requestId = request.requestId ?? 'default-request';

  if (handledMutationRequestId === requestId) {
    return;
  }

  if (![
    'select-first-thread',
    'rename-first-thread',
    'create-first-thread-record',
    'edit-first-record-body',
  ].includes(request.action)) {
    writeLog('mutation_request_ignored', request);
    handledMutationRequestId = requestId;
    return;
  }

  if (request.action === 'select-first-thread') {
    handledMutationRequestId = requestId;
    const selectedState = await ensureFirstThreadSelected();
    const result = {
      requestId,
      action: request.action,
      handledAt: new Date().toISOString(),
      stateAfterClick: selectedState,
    };

    writeJson(mutationResultPath, result);
    writeLog('mutation_request_handled', result);
    return;
  }

  const selectedState = await ensureFirstThreadSelected();

  if (request.action === 'create-first-thread-record') {
    const body = String(request.body ?? '').trim();
    if (body.length === 0) {
      throw new Error('web-mutation-request.json must include a non-empty body for create-first-thread-record.');
    }

    pendingDialogValue = body;
    writeLog('mutation_request', request);

    const createSelector = '[data-testid="create-record-button"]';
    await page.waitForSelector(createSelector, { timeout: 15000 });
    await page.click(createSelector);

    handledMutationRequestId = requestId;
    const afterClickState = await captureState();
    const result = {
      requestId,
      action: request.action,
      body,
      handledAt: new Date().toISOString(),
      stateBeforeClick: selectedState,
      stateAfterClick: afterClickState,
    };

    writeJson(mutationResultPath, result);
    writeLog('mutation_request_handled', result);
    return;
  }

  if (request.action === 'edit-first-record-body') {
    const body = String(request.body ?? '').trim();
    if (body.length === 0) {
      throw new Error('web-mutation-request.json must include a non-empty body for edit-first-record-body.');
    }

    pendingDialogValue = body;
    writeLog('mutation_request', request);

    const editSelector = '[aria-label="Edit record body"]';
    await page.waitForSelector(editSelector, { timeout: 15000 });
    const editButtons = await page.$$(editSelector);
    if (editButtons.length === 0) {
      throw new Error('No record edit button is visible for edit-first-record-body.');
    }

    await editButtons[0].click();

    handledMutationRequestId = requestId;
    const afterClickState = await captureState();
    const result = {
      requestId,
      action: request.action,
      body,
      handledAt: new Date().toISOString(),
      stateBeforeClick: selectedState,
      stateAfterClick: afterClickState,
    };

    writeJson(mutationResultPath, result);
    writeLog('mutation_request_handled', result);
    return;
  }

  const newTitle = String(request.newTitle ?? '').trim();
  if (newTitle.length === 0) {
    throw new Error('web-mutation-request.json must include a non-empty newTitle.');
  }

  pendingDialogValue = newTitle;
  writeLog('mutation_request', request);

  const componentRenameResult = await page.evaluate((requestedTitle) => {
    const globalNg = globalThis.ng;
    if (typeof globalNg?.getComponent !== 'function') {
      return { ok: false, reason: 'angular_debug_api_unavailable' };
    }

    const explorerElement = document.querySelector('app-explorer');
    if (!(explorerElement instanceof Element)) {
      return { ok: false, reason: 'explorer_component_missing' };
    }

    const explorerComponent = globalNg.getComponent(explorerElement);
    if (!explorerComponent || typeof explorerComponent.onRenameEntity !== 'function') {
      return { ok: false, reason: 'explorer_component_unavailable' };
    }

    const selectedThreadId = typeof explorerComponent.selectedThreadId === 'function'
      ? explorerComponent.selectedThreadId()
      : null;
    const threadList = typeof explorerComponent.threadList === 'function'
      ? explorerComponent.threadList()
      : [];
    const firstVisibleThreadId = Array.isArray(threadList) && threadList.length > 0
      ? (threadList[0]?.id ?? null)
      : null;
    const targetThreadId = selectedThreadId ?? firstVisibleThreadId;

    if (typeof targetThreadId !== 'string' || targetThreadId.length === 0) {
      return {
        ok: false,
        reason: 'no_target_thread',
        activePane: typeof explorerComponent.activePane === 'function'
          ? explorerComponent.activePane()
          : null,
        selectedThreadId,
        visibleThreadCount: Array.isArray(threadList) ? threadList.length : null,
      };
    }

    explorerComponent.onRenameEntity('thread', targetThreadId, requestedTitle);
    return {
      ok: true,
      targetThreadId,
      selectedThreadId,
      visibleThreadCount: Array.isArray(threadList) ? threadList.length : null,
    };
  }, newTitle);

  writeLog('mutation_component_attempt', componentRenameResult);

  if (componentRenameResult?.ok === true) {
    handledMutationRequestId = requestId;
    const afterComponentState = await captureState();

    const result = {
      requestId,
      action: request.action,
      newTitle,
      handledAt: new Date().toISOString(),
      trigger: 'component',
      componentRenameResult,
      stateAfterClick: afterComponentState,
    };

    writeJson(mutationResultPath, result);
    writeLog('mutation_request_handled', result);
    return;
  }

  const renameSelector = '[data-testid="thread-item"] .panel-action-button[aria-label="Rename thread"]';
  await page.waitForSelector(renameSelector, { timeout: 15000 });
  await page.click(renameSelector);

  handledMutationRequestId = requestId;
  const afterClickState = await captureState();

  const result = {
    requestId,
    action: request.action,
    newTitle,
    handledAt: new Date().toISOString(),
    stateAfterClick: afterClickState,
  };

  writeJson(mutationResultPath, result);
  writeLog('mutation_request_handled', result);
};

await captureState();

const stateInterval = setInterval(() => {
  void captureState().catch((error) => writeLog('capture_state_error', error.stack ?? error.message));
}, 2000);

const mutationInterval = setInterval(() => {
  void executeMutationRequest().catch((error) => writeLog('mutation_request_error', error.stack ?? error.message));
}, 1000);

const heartbeatInterval = setInterval(() => {
  writeLog('heartbeat', 'browser session still active');
}, 30000);

const shutdown = async (signal) => {
  clearInterval(stateInterval);
  clearInterval(mutationInterval);
  clearInterval(heartbeatInterval);
  writeLog('shutdown', signal);
  await browser.close();
  logStream.end();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));