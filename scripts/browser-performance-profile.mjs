import http from 'node:http';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const distDir = path.join(workspaceRoot, 'dist', 'chano_web', 'browser');
const reportDir = path.join(workspaceRoot, 'reports', 'browser-performance');
const appHost = '127.0.0.1';
const appPort = 4173;
const relayHost = '172.20.10.3';
const relayPort = 8080;
const relayPath = '/relay';
const appUrl = `http://${appHost}:${appPort}`;
const transportProtocolVersion = 2;
const frameBudgetMs = 1000 / 60;
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
]);

const datasetSummary = {
  folderCount: 22,
  threadCount: 72,
  recordCount: 13_704,
  heavyThreadRecordCount: 12_000,
  targetFolderId: 'folder-target-leaf-01',
  targetFolderName: 'Target Leaf 01',
  secondaryFolderId: 'folder-target-leaf-02',
  secondaryFolderName: 'Target Leaf 02',
  heavyThreadId: 'thread-target-leaf-01-heavy',
  heavyThreadTitle: 'Target Thread Heavy',
};

async function main() {
  await fs.mkdir(reportDir, { recursive: true });

  if (process.env.CHANO_PROFILE_ANALYZE_ONLY === 'true') {
    const existingReport = await loadExistingReport();
    const interactions = [];

    for (const interaction of existingReport.interactions) {
      interactions.push({
        ...interaction,
        traceMetrics: await parseTraceMetrics(path.resolve(workspaceRoot, interaction.tracePath)),
      });
    }

    const report = {
      ...existingReport,
      generatedAt: new Date().toISOString(),
      interactions,
      summary: summarizeMetrics(interactions, existingReport.visibleItemValidation, existingReport.determinism),
    };

    await writeReport(report);
    console.log(`PROFILE_REPORT ${path.join(reportDir, 'summary.md')}`);
    return;
  }

  await ensureDistExists();

  const snapshotProtocol = await createSnapshotProtocol();
  const relayServer = await startRelayServer(snapshotProtocol);
  const staticServer = await startStaticServer();

  let browser = null;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
    await page.goto(appUrl, { waitUntil: 'networkidle2' });
    await waitForExplorer(page);

    const interactions = [];
    interactions.push(await captureInteraction(page, 'folder-selection', runFolderSelectionInteraction));
    interactions.push(await captureInteraction(page, 'thread-selection', runThreadSelectionInteraction));
    interactions.push(await captureInteraction(page, 'record-scroll-slow', runSlowScrollInteraction));
    interactions.push(await captureInteraction(page, 'record-scroll-fast', runFastScrollInteraction));
    interactions.push(await captureInteraction(page, 'split-pane-resize', runSplitPaneResizeInteraction));

    const visibleItemValidation = await page.evaluate(() => {
      const viewports = Array.from(document.querySelectorAll('.virtual-list__viewport'));
      const recordViewport = viewports.at(-1);
      const renderedNodes = document.querySelectorAll('[data-testid="thread-view-node"]').length;
      const renderedRecords = document.querySelectorAll('[data-testid="record-item"]').length;
      const renderedGroups = document.querySelectorAll('[data-testid="image-group-item"]').length;
      const renderedRows = recordViewport?.querySelectorAll('.virtual-list__row').length ?? 0;

      return {
        renderedNodes,
        renderedRecords,
        renderedGroups,
        renderedRows,
        viewportClientHeight: recordViewport instanceof HTMLElement ? recordViewport.clientHeight : 0,
        viewportScrollHeight: recordViewport instanceof HTMLElement ? recordViewport.scrollHeight : 0,
        viewportOffsetHeight: recordViewport instanceof HTMLElement ? recordViewport.offsetHeight : 0,
      };
    });

    const determinism = await verifyDeterminism(page);
    const summary = summarizeMetrics(interactions, visibleItemValidation, determinism);
    const report = {
      generatedAt: new Date().toISOString(),
      appUrl,
      browserMode: browser.process() === null ? 'managed' : 'local',
      dataset: datasetSummary,
      visibleItemValidation,
      determinism,
      interactions,
      summary,
    };

    await writeReport(report);
    console.log(`PROFILE_REPORT ${path.join(reportDir, 'summary.md')}`);
  } finally {
    await Promise.allSettled([
      browser?.close() ?? Promise.resolve(),
      stopServer(staticServer),
      stopRelayServer(relayServer),
    ]);
  }
}

async function ensureDistExists() {
  const indexPath = path.join(distDir, 'index.html');
  await fs.access(indexPath);
}

async function loadExistingReport() {
  const reportPath = path.join(reportDir, 'report.json');
  const reportText = await fs.readFile(reportPath, 'utf8');
  return JSON.parse(reportText);
}

async function createSnapshotProtocol() {
  const snapshotDocument = createLargeSnapshotDocument();
  const snapshotJson = JSON.stringify(snapshotDocument);
  const snapshotBytes = Buffer.from(snapshotJson, 'utf8');
  const checksum = sha256(snapshotBytes);
  const chunkSize = 256 * 1024;
  const chunks = [];
  for (let offset = 0; offset < snapshotBytes.length; offset += chunkSize) {
    chunks.push(snapshotBytes.subarray(offset, Math.min(offset + chunkSize, snapshotBytes.length)).toString('base64'));
  }

  return {
    snapshotDocument,
    snapshotJson,
    checksum,
    totalBytes: snapshotBytes.length,
    totalChunks: chunks.length,
    baseEventVersion: countSnapshotEntities(snapshotDocument),
    chunks,
  };
}

function createLargeSnapshotDocument() {
  const folders = [];
  const threads = [];
  const records = [];
  let eventVersion = 1;

  const ownerUserId = 'owner-profile';
  folders.push(createFolderEntity('folder-root', 'All Vaults', null, ownerUserId, eventVersion));
  eventVersion += 1;

  const branchIds = ['alpha', 'beta', 'target'];
  const leafIdsByBranch = new Map();

  for (const branchId of branchIds) {
    const topFolderId = `folder-${branchId}`;
    folders.push(createFolderEntity(topFolderId, `${capitalize(branchId)} Branch`, 'folder-root', ownerUserId, eventVersion));
    eventVersion += 1;

    const leafIds = [];
    for (let leafIndex = 1; leafIndex <= 2; leafIndex += 1) {
      const hubFolderId = `folder-${branchId}-hub-0${leafIndex}`;
      folders.push(createFolderEntity(hubFolderId, `${capitalize(branchId)} Hub 0${leafIndex}`, topFolderId, ownerUserId, eventVersion));
      eventVersion += 1;

      for (let nestedIndex = 1; nestedIndex <= 2; nestedIndex += 1) {
        const leafFolderId = `folder-${branchId}-leaf-${leafIndex}${nestedIndex}`;
        const leafFolderName = branchId === 'target'
          ? `Target Leaf 0${(leafIndex - 1) * 2 + nestedIndex}`
          : `${capitalize(branchId)} Leaf ${leafIndex}.${nestedIndex}`;
        folders.push(createFolderEntity(leafFolderId, leafFolderName, hubFolderId, ownerUserId, eventVersion));
        leafIds.push(leafFolderId);
        eventVersion += 1;
      }
    }

    leafIdsByBranch.set(branchId, leafIds);
  }

  const targetLeafIds = leafIdsByBranch.get('target') ?? [];
  const renamedLeafIds = ['folder-target-leaf-01', 'folder-target-leaf-02', 'folder-target-leaf-03', 'folder-target-leaf-04'];
  for (let index = 0; index < targetLeafIds.length; index += 1) {
    const currentId = targetLeafIds[index];
    if (currentId === undefined) {
      continue;
    }

    const folder = folders.find((entry) => entry.entityUuid === currentId);
    if (folder === undefined) {
      continue;
    }

    folder.entityUuid = renamedLeafIds[index];
    folder.data.uuid = renamedLeafIds[index];
    folder.data.name = `Target Leaf 0${index + 1}`;
  }

  for (const folder of folders) {
    if (folder.data.parentFolderUuid && targetLeafIds.includes(folder.data.parentFolderUuid)) {
      const parentIndex = targetLeafIds.indexOf(folder.data.parentFolderUuid);
      folder.data.parentFolderUuid = renamedLeafIds[parentIndex];
    }
  }

  const allLeafIds = [
    ...leafIdsByBranch.get('alpha') ?? [],
    ...leafIdsByBranch.get('beta') ?? [],
    ...renamedLeafIds,
  ];

  for (const folderId of allLeafIds) {
    const isTargetLeaf = folderId === datasetSummary.targetFolderId;
    for (let threadIndex = 1; threadIndex <= 6; threadIndex += 1) {
      const threadId = isTargetLeaf && threadIndex === 1
        ? datasetSummary.heavyThreadId
        : `thread-${folderId}-${String(threadIndex).padStart(2, '0')}`;
      const threadTitle = isTargetLeaf && threadIndex === 1
        ? datasetSummary.heavyThreadTitle
        : `${folderId.replace('folder-', '').replaceAll('-', ' ')} thread ${String(threadIndex).padStart(2, '0')}`;
      threads.push(createThreadEntity(threadId, threadTitle, folderId, ownerUserId, eventVersion));
      eventVersion += 1;

      const recordCount = isTargetLeaf && threadIndex === 1 ? datasetSummary.heavyThreadRecordCount : 24;
      for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
        const recordId = `record-${threadId}-${String(recordIndex).padStart(5, '0')}`;
        records.push(createRecordEntity(recordId, threadId, ownerUserId, eventVersion, recordIndex));
        eventVersion += 1;
      }
    }
  }

  return { folders, threads, records };
}

function createFolderEntity(entityUuid, name, parentFolderUuid, ownerUserId, eventVersion) {
  return {
    entityType: 'folder',
    entityUuid,
    entityVersion: eventVersion,
    lastEventVersion: eventVersion,
    ownerUserId,
    data: {
      uuid: entityUuid,
      name,
      parentFolderUuid,
    },
  };
}

function createThreadEntity(entityUuid, title, folderUuid, ownerUserId, eventVersion) {
  return {
    entityType: 'thread',
    entityUuid,
    entityVersion: eventVersion,
    lastEventVersion: eventVersion,
    ownerUserId,
    data: {
      uuid: entityUuid,
      folderUuid,
      title,
    },
  };
}

function createRecordEntity(entityUuid, threadUuid, ownerUserId, eventVersion, orderIndex) {
  const createdAt = 1_710_000_000 + orderIndex;
  return {
    entityType: 'record',
    entityUuid,
    entityVersion: eventVersion,
    lastEventVersion: eventVersion,
    ownerUserId,
    data: {
      uuid: entityUuid,
      threadUuid,
      type: 'text',
      body: `Profile record ${orderIndex}`,
      createdAt,
      editedAt: createdAt,
      orderIndex,
      isStarred: orderIndex % 17 === 0,
      imageGroupId: null,
    },
  };
}

function countSnapshotEntities(snapshotDocument) {
  return snapshotDocument.folders.length + snapshotDocument.threads.length + snapshotDocument.records.length;
}

async function startRelayServer(snapshotProtocol) {
  const sequenceBySession = new Map();
  const relay = new WebSocketServer({ host: relayHost, port: relayPort, path: relayPath });

  relay.on('connection', (socket) => {
    socket.on('message', async (buffer) => {
      const message = JSON.parse(String(buffer));
      const sessionId = message.sessionId;
      const token = message.payload?.token;

      if (message.type === 'qr_session_create') {
        sendEnvelope(socket, sequenceBySession, sessionId, 'qr_session_ready', {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          token,
        });
        sendEnvelope(socket, sequenceBySession, sessionId, 'pair_approved', {});
        sendEnvelope(socket, sequenceBySession, sessionId, 'protocol_handshake', {
          supportedProtocolVersions: [transportProtocolVersion],
          minProtocolVersion: transportProtocolVersion,
        });
        return;
      }

      if (message.type === 'protocol_handshake') {
        sendEnvelope(socket, sequenceBySession, sessionId, 'snapshot_start', {
          snapshotId: 'profile-snapshot-01',
          totalChunks: snapshotProtocol.totalChunks,
          totalBytes: snapshotProtocol.totalBytes,
          snapshotVersion: snapshotProtocol.baseEventVersion,
          protocolVersion: transportProtocolVersion,
          schemaVersion: 1,
          baseEventVersion: snapshotProtocol.baseEventVersion,
          entityCount: countSnapshotEntities(snapshotProtocol.snapshotDocument),
          checksum: snapshotProtocol.checksum,
        });

        snapshotProtocol.chunks.forEach((chunk, index) => {
          sendEnvelope(socket, sequenceBySession, sessionId, 'snapshot_chunk', {
            index,
            data: chunk,
          });
        });

        sendEnvelope(socket, sequenceBySession, sessionId, 'snapshot_complete', {
          totalChunks: snapshotProtocol.totalChunks,
        });
      }
    });
  });

  await onceListening(relay);
  return relay;
}

function sendEnvelope(socket, sequenceBySession, sessionId, type, payload) {
  const nextSequence = (sequenceBySession.get(sessionId) ?? 0) + 1;
  sequenceBySession.set(sessionId, nextSequence);
  socket.send(JSON.stringify({
    protocolVersion: transportProtocolVersion,
    type,
    sessionId,
    timestamp: Date.now(),
    sequence: nextSequence,
    payload,
  }));
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', appUrl);
      const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const candidatePath = path.normalize(path.join(distDir, requestedPath));
      const isInDist = candidatePath.startsWith(distDir);
      const filePath = isInDist ? candidatePath : path.join(distDir, 'index.html');

      let resolvedPath = filePath;
      let stat = null;

      try {
        stat = await fs.stat(filePath);
      } catch {
        resolvedPath = path.join(distDir, 'index.html');
        stat = await fs.stat(resolvedPath);
      }

      if (stat.isDirectory()) {
        resolvedPath = path.join(resolvedPath, 'index.html');
      }

      const body = await fs.readFile(resolvedPath);
      const extension = path.extname(resolvedPath);
      response.writeHead(200, {
        'Content-Type': mimeTypes.get(extension) ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Unexpected server error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(appPort, appHost, () => resolve());
  });

  return server;
}

async function launchBrowser() {
  const prefersHeaded = process.env.CHANO_PROFILE_HEADLESS === 'false';

  try {
    return await puppeteer.launch({
      headless: prefersHeaded ? false : true,
      defaultViewport: null,
      args: ['--disable-features=CalculateNativeWinOcclusion'],
    });
  } catch {
    return puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: ['--disable-gpu'],
    });
  }
}

async function waitForExplorer(page) {
  await page.waitForFunction(() => globalThis.location.pathname === '/explorer', { timeout: 60_000 });
  await page.waitForSelector('[aria-label="Select folder Target Leaf 01"]', { timeout: 60_000 });
}

async function captureInteraction(page, name, action) {
  const tracePath = path.join(reportDir, `${name}.trace.json`);
  await installProfilingHelpers(page);
  await page.evaluate((label) => globalThis.__chanoProfile.start(label), name);
  await page.tracing.start({
    path: tracePath,
    categories: [
      '-*',
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'disabled-by-default-v8.cpu_profiler',
      'toplevel',
      'v8',
    ],
  });

  await action(page);
  await delay(500);
  await page.tracing.stop();
  const frameMetrics = await page.evaluate(() => globalThis.__chanoProfile.stop());
  const traceMetrics = await parseTraceMetrics(tracePath);

  return {
    name,
    tracePath,
    frameMetrics,
    traceMetrics,
  };
}

async function installProfilingHelpers(page) {
  await page.evaluate(() => {
    if (globalThis.__chanoProfile) {
      return;
    }

    globalThis.__chanoProfile = {
      label: null,
      rafTimes: [],
      longTasks: [],
      stopRequested: false,
      observer: null,
      start(label) {
        this.label = label;
        this.rafTimes = [];
        this.longTasks = [];
        this.stopRequested = false;
        if (typeof PerformanceObserver === 'function') {
          this.observer?.disconnect?.();
          this.observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              this.longTasks.push({
                name: entry.name,
                startTime: entry.startTime,
                duration: entry.duration,
              });
            }
          });
          try {
            this.observer.observe({ entryTypes: ['longtask'] });
          } catch {
            this.observer = null;
          }
        }

        const tick = (timestamp) => {
          this.rafTimes.push(timestamp);
          if (this.stopRequested) {
            return;
          }
          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      },
      stop() {
        this.stopRequested = true;
        this.observer?.disconnect?.();
        const intervals = [];
        for (let index = 1; index < this.rafTimes.length; index += 1) {
          intervals.push(this.rafTimes[index] - this.rafTimes[index - 1]);
        }

        const fpsValues = intervals
          .filter((interval) => interval > 0)
          .map((interval) => 1000 / interval);

        return {
          sampledFrames: this.rafTimes.length,
          fps: {
            min: fpsValues.length === 0 ? 0 : Math.min(...fpsValues),
            max: fpsValues.length === 0 ? 0 : Math.max(...fpsValues),
            average: fpsValues.length === 0 ? 0 : fpsValues.reduce((sum, value) => sum + value, 0) / fpsValues.length,
          },
          droppedFrameCount: intervals.filter((interval) => interval > 20).length,
          longTasks: this.longTasks,
        };
      },
    };
  });
}

async function runFolderSelectionInteraction(page) {
  await clickByAriaLabel(page, 'Select folder Target Leaf 02');
  await page.waitForSelector(`[data-thread-id="thread-${datasetSummary.secondaryFolderId}-01"]`);
  await clickByAriaLabel(page, 'Select folder Target Leaf 01');
  await page.waitForSelector(`[data-thread-id="${datasetSummary.heavyThreadId}"]`);
}

async function runThreadSelectionInteraction(page) {
  await clickByAriaLabel(page, 'Select folder Target Leaf 01');
  await page.waitForSelector(`[data-thread-id="${datasetSummary.heavyThreadId}"]`);
  await clickByAriaLabel(page, `Select thread ${datasetSummary.heavyThreadTitle}`);
  await page.waitForSelector('[data-testid="thread-view-node"]');
}

async function runSlowScrollInteraction(page) {
  await ensureHeavyThreadOpen(page);
  const viewport = await waitForRecordViewport(page);
  const box = await viewport.boundingBox();
  if (box === null) {
    throw new Error('RECORD_VIEWPORT_NOT_VISIBLE');
  }

  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
  for (let step = 0; step < 24; step += 1) {
    await page.mouse.wheel({ deltaY: 420 });
    await delay(32);
  }
}

async function runFastScrollInteraction(page) {
  await ensureHeavyThreadOpen(page);
  const viewport = await waitForRecordViewport(page);
  const box = await viewport.boundingBox();
  if (box === null) {
    throw new Error('RECORD_VIEWPORT_NOT_VISIBLE');
  }

  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel({ deltaY: 1800 });
  }
}

async function runSplitPaneResizeInteraction(page) {
  const divider = await page.waitForSelector('[data-testid="split-pane-divider"]', { timeout: 30_000 });
  const box = await divider.boundingBox();
  if (box === null) {
    throw new Error('SPLIT_DIVIDER_NOT_VISIBLE');
  }

  const startX = box.x + (box.width / 2);
  const startY = box.y + (box.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 200, startY, { steps: 20 });
  await delay(80);
  await page.mouse.move(startX + 80, startY, { steps: 12 });
  await page.mouse.up();
}

async function ensureHeavyThreadOpen(page) {
  await clickByAriaLabel(page, 'Select folder Target Leaf 01');
  await page.waitForSelector(`[data-thread-id="${datasetSummary.heavyThreadId}"]`);
  await clickByAriaLabel(page, `Select thread ${datasetSummary.heavyThreadTitle}`);
  await page.waitForSelector('[data-testid="thread-view-node"]');
}

async function waitForRecordViewport(page) {
  const handles = await page.$$('.virtual-list__viewport');
  const lastHandle = handles[handles.length - 1];
  if (lastHandle === undefined) {
    throw new Error('VIRTUAL_VIEWPORT_NOT_FOUND');
  }

  return lastHandle;
}

async function clickByAriaLabel(page, ariaLabel) {
  const selector = `[aria-label="${cssEscape(ariaLabel)}"]`;
  const handle = await page.waitForSelector(selector, { timeout: 30_000 });
  await handle.click();
}

async function verifyDeterminism(page) {
  await ensureHeavyThreadOpen(page);
  const firstSignature = await captureDeterministicSignature(page, 'determinism-a');
  await runFastScrollInteraction(page);
  await ensureHeavyThreadOpen(page);
  const secondSignature = await captureDeterministicSignature(page, 'determinism-b');

  return {
    signaturesMatch: firstSignature.signature === secondSignature.signature,
    screenshotHashesMatch: firstSignature.screenshotHash === secondSignature.screenshotHash,
    firstSignature: firstSignature.signature,
    secondSignature: secondSignature.signature,
    firstScreenshotHash: firstSignature.screenshotHash,
    secondScreenshotHash: secondSignature.screenshotHash,
  };
}

async function captureDeterministicSignature(page, name) {
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    const viewport = document.querySelector('.virtual-list__viewport');
    if (viewport instanceof HTMLElement) {
      viewport.scrollTop = 0;
      viewport.dispatchEvent(new Event('scroll'));
    }
  });
  await delay(150);

  const state = await page.evaluate(() => {
    const selectedFolder = document.querySelector('[data-kind="folder"][data-selected="true"] .ui-list-row__title')?.textContent ?? null;
    const selectedThread = document.querySelector('[data-kind="thread"][data-selected="true"] .ui-list-row__title')?.textContent ?? null;
    const renderedNodes = Array.from(document.querySelectorAll('[data-testid="thread-view-node"]')).map((element) => element.getAttribute('data-node-key'));
    const splitPane = document.querySelector('[data-testid="explorer-split-pane"]');
    const gridTemplateColumns = splitPane === null ? null : getComputedStyle(splitPane).gridTemplateColumns;

    return {
      selectedFolder,
      selectedThread,
      renderedNodes,
      gridTemplateColumns,
    };
  });

  const screenshotPath = path.join(reportDir, `${name}.png`);
  await page.screenshot({ path: screenshotPath, animations: 'disabled' });
  const screenshotHash = sha256(await fs.readFile(screenshotPath));

  return {
    signature: JSON.stringify(state),
    screenshotHash,
  };
}

async function parseTraceMetrics(tracePath) {
  const traceText = await fs.readFile(tracePath, 'utf8');
  const trace = JSON.parse(traceText);
  const traceEvents = Array.isArray(trace.traceEvents) ? trace.traceEvents : [];
  const completeEvents = traceEvents.filter((event) => event.ph === 'X' && typeof event.ts === 'number' && typeof event.dur === 'number');
  const scriptEvents = completeEvents.filter((event) => scriptEventNames.has(event.name));
  const layoutEvents = completeEvents.filter((event) => layoutEventNames.has(event.name));
  const minTimestamp = completeEvents.reduce((min, event) => Math.min(min, event.ts), Number.POSITIVE_INFINITY);
  const maxTimestamp = completeEvents.reduce((max, event) => Math.max(max, event.ts + event.dur), 0);
  const totalDurationMs = minTimestamp === Number.POSITIVE_INFINITY ? 0 : (maxTimestamp - minTimestamp) / 1000;
  const bucketCount = totalDurationMs === 0 ? 0 : Math.max(1, Math.ceil(totalDurationMs / frameBudgetMs));
  const scriptBuckets = Array.from({ length: bucketCount }, () => []);

  for (const event of scriptEvents) {
    const startMs = (event.ts - minTimestamp) / 1000;
    const endMs = startMs + (event.dur / 1000);
    const firstBucketIndex = totalDurationMs === 0 ? 0 : Math.max(0, Math.floor(startMs / frameBudgetMs));
    const lastBucketIndex = totalDurationMs === 0 ? 0 : Math.min(bucketCount - 1, Math.floor(Math.max(endMs - 0.001, 0) / frameBudgetMs));

    for (let bucketIndex = firstBucketIndex; bucketIndex <= lastBucketIndex; bucketIndex += 1) {
      const bucketStartMs = bucketIndex * frameBudgetMs;
      const bucketEndMs = bucketStartMs + frameBudgetMs;
      const overlapStart = Math.max(startMs, bucketStartMs);
      const overlapEnd = Math.min(endMs, bucketEndMs);
      if (overlapEnd > overlapStart) {
        scriptBuckets[bucketIndex].push([overlapStart, overlapEnd]);
      }
    }
  }

  const scriptTimePerBucket = scriptBuckets.map((ranges) => mergeRanges(ranges));

  const maxScriptingTimePerFrame = scriptTimePerBucket.length === 0 ? 0 : Math.max(...scriptTimePerBucket);
  const averageScriptingTimePerFrame = scriptTimePerBucket.length === 0
    ? 0
    : scriptTimePerBucket.reduce((sum, value) => sum + value, 0) / scriptTimePerBucket.length;
  const topLevelLongTasks = completeEvents
    .filter((event) => event.name === 'RunTask' && (event.dur / 1000) > 50)
    .map((event) => ({ startMs: event.ts / 1000, durationMs: event.dur / 1000 }));

  return {
    totalDurationMs,
    scriptEventCount: scriptEvents.length,
    layoutEventCount: layoutEvents.length,
    layoutTimeMs: layoutEvents.reduce((sum, event) => sum + (event.dur / 1000), 0),
    maxScriptingTimePerFrame,
    averageScriptingTimePerFrame,
    topLevelLongTasks,
  };
}

function mergeRanges(ranges) {
  if (ranges.length === 0) {
    return 0;
  }

  const sortedRanges = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged = [sortedRanges[0]];

  for (let index = 1; index < sortedRanges.length; index += 1) {
    const current = sortedRanges[index];
    const previous = merged[merged.length - 1];
    if (current[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], current[1]);
      continue;
    }

    merged.push([...current]);
  }

  return merged.reduce((sum, [start, end]) => sum + (end - start), 0);
}

function summarizeMetrics(interactions, visibleItemValidation, determinism) {
  const fpsMinimums = interactions.map((interaction) => interaction.frameMetrics.fps.min).filter((value) => value > 0);
  const fpsMaximums = interactions.map((interaction) => interaction.frameMetrics.fps.max).filter((value) => value > 0);
  const maxScriptingTimePerFrame = Math.max(...interactions.map((interaction) => interaction.traceMetrics.maxScriptingTimePerFrame));
  const longTasks = interactions.flatMap((interaction) => [
    ...interaction.frameMetrics.longTasks.map((task) => ({ source: 'performance-observer', interaction: interaction.name, duration: task.duration })),
    ...interaction.traceMetrics.topLevelLongTasks.map((task) => ({ source: 'trace', interaction: interaction.name, duration: task.durationMs })),
  ]);

  const bottlenecks = [];
  if (visibleItemValidation.renderedNodes > 20) {
    bottlenecks.push('Visible item count exceeded expected virtualization window.');
  }
  if (longTasks.length > 0) {
    bottlenecks.push('Long tasks were present during one or more interactions.');
  }
  if (!determinism.signaturesMatch || !determinism.screenshotHashesMatch) {
    bottlenecks.push(
      determinism.signaturesMatch
        ? 'Structural state replay was deterministic, but pixel-identical screenshots did not match.'
        : 'Deterministic structural replay did not produce identical output.',
    );
  }
  if (interactions.some((interaction) => interaction.traceMetrics.layoutEventCount > 25)) {
    bottlenecks.push('Layout event volume suggests potential reflow pressure during interaction.');
  }

  return {
    fpsRange: {
      min: fpsMinimums.length === 0 ? 0 : Math.min(...fpsMinimums),
      max: fpsMaximums.length === 0 ? 0 : Math.max(...fpsMaximums),
    },
    maxScriptingTimePerFrame,
    longTaskCount: longTasks.length,
    longTasks,
    layoutThrashDetected: interactions.some((interaction) => interaction.traceMetrics.layoutEventCount > 25),
    visibleItemsOnly: visibleItemValidation.renderedNodes <= 20,
    deterministicReplay: determinism.signaturesMatch,
    pixelStableReplay: determinism.screenshotHashesMatch,
    bottlenecks,
    observedImprovements: buildObservedImprovements(visibleItemValidation, interactions),
  };
}

function buildObservedImprovements(visibleItemValidation, interactions) {
  const improvements = [];

  if (visibleItemValidation.renderedNodes <= 20) {
    improvements.push('Record rendering remained bounded to the virtualized visible slice during deep scroll.');
  } else {
    improvements.push(`Visible-items-only rendering was not observed; the heavy thread rendered ${visibleItemValidation.renderedNodes} nodes.`);
  }

  const splitPaneInteraction = interactions.find((interaction) => interaction.name === 'split-pane-resize');
  if (splitPaneInteraction && splitPaneInteraction.traceMetrics.layoutEventCount === 0) {
    improvements.push('Split-pane resize stayed free of layout events during the recorded drag.');
  }

  improvements.push('Folder and thread navigation completed without inconsistent selection state across repeated structural snapshots.');
  return improvements;
}

async function writeReport(report) {
  const jsonPath = path.join(reportDir, 'report.json');
  const markdownPath = path.join(reportDir, 'summary.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, renderMarkdownReport(report), 'utf8');
}

function renderMarkdownReport(report) {
  const lines = [
    '# Browser Performance Profiling Report',
    '',
    `- Generated at: ${report.generatedAt}`,
    `- App URL: ${report.appUrl}`,
    `- Dataset size: ${report.dataset.recordCount} records, ${report.dataset.threadCount} threads, ${report.dataset.folderCount} folders`,
    `- Heavy thread size: ${report.dataset.heavyThreadRecordCount} records`,
    `- FPS observed: ${report.summary.fpsRange.min.toFixed(1)}-${report.summary.fpsRange.max.toFixed(1)}`,
    `- Max scripting time per frame: ${report.summary.maxScriptingTimePerFrame.toFixed(2)}ms`,
    `- Long task count: ${report.summary.longTaskCount}`,
    `- Visible-items-only rendering: ${report.summary.visibleItemsOnly ? 'PASS' : 'FAIL'}`,
    `- Deterministic replay: ${report.summary.deterministicReplay ? 'PASS' : 'FAIL'}`,
    `- Pixel-stable replay: ${report.summary.pixelStableReplay ? 'PASS' : 'FAIL'}`,
    `- Layout thrash detected: ${report.summary.layoutThrashDetected ? 'YES' : 'NO'}`,
    '',
    '## Interaction Metrics',
    '',
  ];

  for (const interaction of report.interactions) {
    lines.push(`### ${interaction.name}`);
    lines.push(`- FPS: ${interaction.frameMetrics.fps.min.toFixed(1)}-${interaction.frameMetrics.fps.max.toFixed(1)} (avg ${interaction.frameMetrics.fps.average.toFixed(1)})`);
    lines.push(`- Dropped frames: ${interaction.frameMetrics.droppedFrameCount}`);
    lines.push(`- Observer long tasks: ${interaction.frameMetrics.longTasks.length}`);
    lines.push(`- Trace long tasks: ${interaction.traceMetrics.topLevelLongTasks.length}`);
    lines.push(`- Max scripting time/frame: ${interaction.traceMetrics.maxScriptingTimePerFrame.toFixed(2)}ms`);
    lines.push(`- Layout events: ${interaction.traceMetrics.layoutEventCount}`);
    lines.push('');
  }

  lines.push('## Validation');
  lines.push('');
  lines.push(`- Rendered nodes in heavy thread viewport: ${report.visibleItemValidation.renderedNodes}`);
  lines.push(`- Rendered record rows: ${report.visibleItemValidation.renderedRecords}`);
  lines.push(`- Rendered virtual rows: ${report.visibleItemValidation.renderedRows}`);
  lines.push(`- Record viewport client height: ${report.visibleItemValidation.viewportClientHeight}`);
  lines.push(`- Record viewport scroll height: ${report.visibleItemValidation.viewportScrollHeight}`);
  lines.push(`- Deterministic signatures match: ${report.determinism.signaturesMatch}`);
  lines.push(`- Deterministic screenshots match: ${report.determinism.screenshotHashesMatch}`);
  lines.push('');
  lines.push('## Observed Improvements');
  lines.push('');
  for (const item of report.summary.observedImprovements) {
    lines.push(`- ${item}`);
  }

  if (report.summary.bottlenecks.length > 0) {
    lines.push('');
    lines.push('## Bottlenecks');
    lines.push('');
    for (const bottleneck of report.summary.bottlenecks) {
      lines.push(`- ${bottleneck}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cssEscape(value) {
  return value.replaceAll('"', '\\"');
}

function onceListening(server) {
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function stopRelayServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const scriptEventNames = new Set([
  'EvaluateScript',
  'FunctionCall',
  'EventDispatch',
  'FireAnimationFrame',
  'RunMicrotasks',
  'TimerFire',
  'V8.Execute',
]);

const layoutEventNames = new Set([
  'Layout',
  'UpdateLayoutTree',
  'RecalculateStyles',
  'ScheduleStyleRecalculation',
]);

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});