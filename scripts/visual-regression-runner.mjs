import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import puppeteer from 'puppeteer';
import { PNG } from 'pngjs';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const distDir = path.join(workspaceRoot, 'dist', 'chano_web', 'browser');
const baselineDir = path.join(workspaceRoot, 'visual-baseline', 'explorer');
const reportDir = path.join(workspaceRoot, 'reports', 'visual-regression');
const currentDir = path.join(reportDir, 'current');
const diffDir = path.join(reportDir, 'diff');
const staticHost = '127.0.0.1';
const staticPort = 4174;
const relayHost = '127.0.0.1';
const relayPort = 18080;
const relayPath = '/relay';
const relayPublicUrl = `ws://${relayHost}:${relayPort}${relayPath}`;
const runtimeRelayUrl = 'ws://172.20.10.3:8080/relay';
const appUrl = `http://${staticHost}:${staticPort}`;
const transportProtocolVersion = 2;
const viewport = Object.freeze({ width: 1440, height: 960, deviceScaleFactor: 1 });
const fontAssetRoute = '/__visual-assets__/fonts/noto-sans-latin-wght-normal.woff2';
const fontAssetPath = path.join(
  workspaceRoot,
  'node_modules',
  '@fontsource-variable',
  'noto-sans',
  'files',
  'noto-sans-latin-wght-normal.woff2',
);
const pixelThreshold = 0.1;
const maxDiffPixels = 0;
const maxDiffRatio = 0;
const captureDefinitions = Object.freeze([
  {
    id: 'folder-tree-panel',
    selector: '[aria-label="Folder tree panel"]',
    prepare: async () => {},
  },
  {
    id: 'content-empty-state',
    selector: '[aria-label="Content pane panel"]',
    prepare: async () => {},
  },
  {
    id: 'thread-list-panel',
    selector: '[aria-label="Content pane panel"]',
    prepare: async (page) => {
      await clickByAriaLabel(page, 'Select folder Target Leaf 01');
      await page.waitForSelector('[data-testid="thread-item"]', { timeout: 30_000 });
    },
  },
  {
    id: 'thread-view-panel',
    selector: '[aria-label="Content pane panel"]',
    prepare: async (page) => {
      await ensureTargetThreadOpen(page);
    },
  },
  {
    id: 'record-list-viewport',
    selector: '.content-main-section .virtual-list__viewport',
    prepare: async (page) => {
      await ensureTargetThreadOpen(page);
    },
  },
  {
    id: 'empty-thread-list-state',
    selector: '[aria-label="Content pane panel"]',
    prepare: async (page) => {
      await clickByAriaLabel(page, 'Select folder Empty Folder');
      await page.waitForFunction(
        () => document.querySelector('[aria-label="Content pane panel"]')?.textContent?.includes('No threads visible for this folder') === true,
        { timeout: 30_000 },
      );
    },
  },
  {
    id: 'empty-record-list-state',
    selector: '[aria-label="Content pane panel"]',
    prepare: async (page) => {
      await clickByAriaLabel(page, 'Select folder Archive');
      await page.waitForSelector('[data-testid="thread-item"]', { timeout: 30_000 });
      await clickByAriaLabel(page, 'Select thread Quiet Thread');
      await page.waitForFunction(
        () => document.querySelector('[aria-label="Content pane panel"]')?.textContent?.includes('No records visible for this thread') === true,
        { timeout: 30_000 },
      );
    },
  },
]);
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

export async function runVisualRegression(options = {}) {
  const updateBaseline = options.updateBaseline === true;

  await ensureDistExists();
  await fs.mkdir(baselineDir, { recursive: true });
  await fs.mkdir(currentDir, { recursive: true });
  await fs.mkdir(diffDir, { recursive: true });

  const snapshotProtocol = await createSnapshotProtocol();
  const relayServer = await startRelayServer(snapshotProtocol);
  const staticServer = await startStaticServer();
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: null,
      args: ['--disable-gpu', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewport(viewport);
    await installRuntimeOverrides(page);
    await page.goto(appUrl, { waitUntil: 'networkidle2' });
    await waitForExplorer(page);
    await injectStableRendering(page);

    const captures = [];
    for (const capture of captureDefinitions) {
      await resetToExplorerRoot(page);
      await capture.prepare(page);
      await settleExplorer(page);
      captures.push(await captureRegion(page, capture.id, capture.selector, updateBaseline));
    }

    const failedCaptures = captures.filter((capture) => capture.status === 'failed');
    const result = {
      mode: updateBaseline ? 'update-baseline' : 'verify',
      generatedAt: new Date().toISOString(),
      appUrl,
      viewport,
      thresholds: {
        pixelThreshold,
        maxDiffPixels,
        maxDiffRatio,
      },
      captures,
      passed: failedCaptures.length === 0,
      failureCount: failedCaptures.length,
      relayPublicUrl,
    };

    await fs.writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (!updateBaseline && failedCaptures.length > 0) {
      const failureDetails = failedCaptures
        .map((capture) => `${capture.id}: ${capture.diffPixels} pixels (${capture.diffRatio.toFixed(6)})`)
        .join('; ');
      throw new Error(`VISUAL_REGRESSION_FAILED ${failureDetails}`);
    }

    return result;
  } finally {
    await Promise.allSettled([
      browser?.close() ?? Promise.resolve(),
      stopRelayServer(relayServer),
      stopServer(staticServer),
    ]);
  }
}

async function ensureDistExists() {
  await fs.access(path.join(distDir, 'index.html'));
}

async function createSnapshotProtocol() {
  const snapshotDocument = createVisualSnapshotDocument();
  const snapshotJson = JSON.stringify(snapshotDocument);
  const snapshotBytes = Buffer.from(snapshotJson, 'utf8');
  const checksum = sha256(snapshotBytes);
  const chunkSize = 64 * 1024;
  const chunks = [];
  for (let offset = 0; offset < snapshotBytes.length; offset += chunkSize) {
    chunks.push(snapshotBytes.subarray(offset, Math.min(offset + chunkSize, snapshotBytes.length)).toString('base64'));
  }

  return {
    snapshotDocument,
    checksum,
    totalBytes: snapshotBytes.length,
    totalChunks: chunks.length,
    baseEventVersion: countSnapshotEntities(snapshotDocument),
    chunks,
  };
}

function createVisualSnapshotDocument() {
  const folders = [];
  const threads = [];
  const records = [];
  const ownerUserId = 'visual-owner';
  let eventVersion = 1;

  const folderRoot = createFolderEntity('folder-root', 'All Vaults', null, ownerUserId, eventVersion++);
  const folderDesign = createFolderEntity('folder-design', 'Design', 'folder-root', ownerUserId, eventVersion++);
  const folderTarget = createFolderEntity('folder-target', 'Product', 'folder-root', ownerUserId, eventVersion++);
  const folderTargetLeaf = createFolderEntity('folder-target-leaf-01', 'Target Leaf 01', 'folder-target', ownerUserId, eventVersion++);
  const folderResearch = createFolderEntity('folder-research', 'Research', 'folder-root', ownerUserId, eventVersion++);
  const folderEmpty = createFolderEntity('folder-empty', 'Empty Folder', 'folder-root', ownerUserId, eventVersion++);
  const folderArchive = createFolderEntity('folder-archive', 'Archive', 'folder-root', ownerUserId, eventVersion++);

  folders.push(folderRoot, folderDesign, folderTarget, folderTargetLeaf, folderResearch, folderEmpty, folderArchive);

  const populatedThreads = [
    createThreadEntity('thread-target-heavy', 'Target Thread Heavy', 'folder-target-leaf-01', ownerUserId, eventVersion++),
    createThreadEntity('thread-target-planning', 'Planning Pass', 'folder-target-leaf-01', ownerUserId, eventVersion++),
    createThreadEntity('thread-target-audit', 'Regression Audit', 'folder-target-leaf-01', ownerUserId, eventVersion++),
  ];
  const archiveThread = createThreadEntity('thread-archive-quiet', 'Quiet Thread', 'folder-archive', ownerUserId, eventVersion++);
  threads.push(...populatedThreads, archiveThread);

  const recordSpecs = [
    ['text', 'Frame capture checklist'],
    ['text', 'Freeze navigation state'],
    ['text', 'Verify pixel hash'],
    ['text', 'Stabilize fonts'],
    ['text', 'Preserve OnPush boundaries'],
    ['text', 'Track split-pane layout'],
    ['text', 'Replay fixed snapshot'],
    ['text', 'Capture folder tree'],
    ['text', 'Capture thread list'],
    ['text', 'Capture record list'],
    ['text', 'Capture empty states'],
    ['text', 'Publish diff artifacts'],
  ];
  for (let index = 0; index < recordSpecs.length; index += 1) {
    const [type, body] = recordSpecs[index];
    records.push(createRecordEntity(
      `record-thread-target-heavy-${String(index).padStart(3, '0')}`,
      'thread-target-heavy',
      ownerUserId,
      eventVersion++,
      index,
      type,
      body,
    ));
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

function createRecordEntity(entityUuid, threadUuid, ownerUserId, eventVersion, orderIndex, type, body) {
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
      type,
      body,
      createdAt,
      editedAt: createdAt,
      orderIndex,
      isStarred: orderIndex === 2,
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
    socket.on('message', (buffer) => {
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
          snapshotId: 'visual-snapshot-01',
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
      if (url.pathname === fontAssetRoute) {
        const fontBody = await fs.readFile(fontAssetPath);
        response.writeHead(200, {
          'Content-Type': 'font/woff2',
          'Cache-Control': 'no-store',
        });
        response.end(fontBody);
        return;
      }

      const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const candidatePath = path.normalize(path.join(distDir, requestedPath));
      const safePath = candidatePath.startsWith(distDir) ? candidatePath : path.join(distDir, 'index.html');

      let resolvedPath = safePath;
      try {
        const stat = await fs.stat(resolvedPath);
        if (stat.isDirectory()) {
          resolvedPath = path.join(resolvedPath, 'index.html');
        }
      } catch {
        resolvedPath = path.join(distDir, 'index.html');
      }

      const body = await fs.readFile(resolvedPath);
      response.writeHead(200, {
        'Content-Type': mimeTypes.get(path.extname(resolvedPath)) ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Unexpected static server error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(staticPort, staticHost, () => resolve());
  });

  return server;
}

async function installRuntimeOverrides(page) {
  await page.evaluateOnNewDocument(({ relayUrl, runtimeUrl }) => {
    const NativeWebSocket = window.WebSocket;
    class RedirectedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        const normalizedUrl = typeof url === 'string' && url === runtimeUrl ? relayUrl : url;
        super(normalizedUrl, protocols);
      }
    }

    Object.defineProperties(RedirectedWebSocket, {
      CONNECTING: { value: NativeWebSocket.CONNECTING },
      OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING },
      CLOSED: { value: NativeWebSocket.CLOSED },
    });
    RedirectedWebSocket.prototype = NativeWebSocket.prototype;
    window.WebSocket = RedirectedWebSocket;

    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.setAttribute('data-visual-regression-style', 'true');
      style.textContent = `
        @font-face {
          font-family: 'Chano Visual Noto';
          src: url('${fontAssetRoute}') format('woff2');
          font-style: normal;
          font-weight: 100 900;
          font-display: block;
        }

        :root {
          font-family: 'Chano Visual Noto', sans-serif;
          color-scheme: light;
        }

        *, *::before, *::after {
          animation: none !important;
          transition: none !important;
          caret-color: transparent !important;
          scroll-behavior: auto !important;
        }
      `;
      document.head.append(style);
    });
  }, { relayUrl: relayPublicUrl, runtimeUrl: runtimeRelayUrl });
}

async function waitForExplorer(page) {
  await page.waitForFunction(() => globalThis.location.pathname === '/explorer', { timeout: 60_000 });
  await page.waitForSelector('[aria-label="Folder tree panel"]', { timeout: 60_000 });
  await page.waitForSelector('[aria-label="Content pane panel"]', { timeout: 60_000 });
}

async function injectStableRendering(page) {
  await page.waitForFunction(async () => {
    if (!('fonts' in document) || document.fonts === undefined) {
      return true;
    }

    await document.fonts.ready;
    return document.fonts.check('14px "Chano Visual Noto"');
  }, { timeout: 30_000 });
}

async function resetToExplorerRoot(page) {
  await page.goto(`${appUrl}/explorer`, { waitUntil: 'networkidle2' });
  await waitForExplorer(page);
  await injectStableRendering(page);
}

async function settleExplorer(page) {
  await page.evaluate(() => {
    const viewports = Array.from(document.querySelectorAll('.virtual-list__viewport'));
    for (const viewportElement of viewports) {
      if (viewportElement instanceof HTMLElement) {
        viewportElement.scrollTop = 0;
        viewportElement.dispatchEvent(new Event('scroll'));
      }
    }
  });
  await delay(120);
}

async function ensureTargetThreadOpen(page) {
  await clickByAriaLabel(page, 'Select folder Target Leaf 01');
  await page.waitForSelector('[data-testid="thread-item"]', { timeout: 30_000 });
  await clickByAriaLabel(page, 'Select thread Target Thread Heavy');
  await page.waitForSelector('[data-testid="thread-view-node"]', { timeout: 30_000 });
}

async function clickByAriaLabel(page, ariaLabel) {
  const selector = `[aria-label="${cssEscape(ariaLabel)}"]`;
  const handle = await page.waitForSelector(selector, { timeout: 30_000 });
  await handle.click();
}

async function captureRegion(page, captureId, selector, updateBaseline) {
  const target = await page.waitForSelector(selector, { timeout: 30_000 });
  const baselinePath = path.join(baselineDir, `${captureId}.png`);
  const currentPath = path.join(currentDir, `${captureId}.png`);
  const diffPath = path.join(diffDir, `${captureId}.png`);
  await target.screenshot({ path: currentPath, omitBackground: false });

  if (updateBaseline || !(await exists(baselinePath))) {
    await fs.copyFile(currentPath, baselinePath);
    if (await exists(diffPath)) {
      await fs.rm(diffPath, { force: true });
    }

    return {
      id: captureId,
      selector,
      baselinePath: toRelativeWorkspacePath(baselinePath),
      currentPath: toRelativeWorkspacePath(currentPath),
      diffPath: null,
      baselineHash: sha256(await fs.readFile(baselinePath)),
      currentHash: sha256(await fs.readFile(currentPath)),
      diffPixels: 0,
      diffRatio: 0,
      status: updateBaseline ? 'updated-baseline' : 'created-baseline',
    };
  }

  const baselineBuffer = await fs.readFile(baselinePath);
  const currentBuffer = await fs.readFile(currentPath);
  const baselinePng = PNG.sync.read(baselineBuffer);
  const currentPng = PNG.sync.read(currentBuffer);

  if (baselinePng.width !== currentPng.width || baselinePng.height !== currentPng.height) {
    throw new Error(`VISUAL_SIZE_MISMATCH ${captureId} baseline=${baselinePng.width}x${baselinePng.height} current=${currentPng.width}x${currentPng.height}`);
  }

  const diffPng = new PNG({ width: baselinePng.width, height: baselinePng.height });
  const diffPixels = pixelmatch(
    baselinePng.data,
    currentPng.data,
    diffPng.data,
    baselinePng.width,
    baselinePng.height,
    { threshold: pixelThreshold },
  );
  const totalPixels = baselinePng.width * baselinePng.height;
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const passed = diffPixels <= maxDiffPixels && diffRatio <= maxDiffRatio;

  if (diffPixels > 0) {
    await fs.writeFile(diffPath, PNG.sync.write(diffPng));
  } else if (await exists(diffPath)) {
    await fs.rm(diffPath, { force: true });
  }

  return {
    id: captureId,
    selector,
    baselinePath: toRelativeWorkspacePath(baselinePath),
    currentPath: toRelativeWorkspacePath(currentPath),
    diffPath: diffPixels > 0 ? toRelativeWorkspacePath(diffPath) : null,
    baselineHash: sha256(baselineBuffer),
    currentHash: sha256(currentBuffer),
    diffPixels,
    diffRatio,
    status: passed ? 'passed' : 'failed',
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toRelativeWorkspacePath(filePath) {
  return path.relative(workspaceRoot, filePath).replaceAll('\\', '/');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
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

if (process.argv[1] === __filename) {
  const updateBaseline = process.argv.includes('--update-baseline');
  runVisualRegression({ updateBaseline })
    .then((result) => {
      console.log(`VISUAL_REGRESSION ${result.mode} captures=${result.captures.length} failures=${result.failureCount}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}