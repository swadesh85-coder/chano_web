import {
  Component,
  OnInit,
  signal,
  computed,
  DestroyRef,
  inject,
  ChangeDetectionStrategy,
  NgZone,
  effect,
} from '@angular/core';
import { Router } from '@angular/router';
import QRCode from 'qrcode';
import { ProjectionStateContainer } from '../projection/projection_state.container';
import { WebRelayClient } from '../../transport';
import type { TransportEnvelope } from '../../transport';

const DEFAULT_RELAY_PORT = '8080';
const DEFAULT_RELAY_PATH = '/relay';
const DEFAULT_DEV_QR_RELAY_URL = `ws://10.0.2.2:${DEFAULT_RELAY_PORT}${DEFAULT_RELAY_PATH}`;
const TRANSPORT_PROTOCOL_VERSION = 2;

function getRuntimeLocation(): Location | null {
  if (typeof globalThis.location !== 'object' || globalThis.location === null) {
    return null;
  }

  return globalThis.location;
}

function createRelayUrl(host: string, protocol: string): string {
  return `${protocol}://${host}:${DEFAULT_RELAY_PORT}${DEFAULT_RELAY_PATH}`;
}

export function resolveBrowserRelayUrl(location: Location | null = getRuntimeLocation()): string {
  if (location === null) {
    return createRelayUrl('localhost', 'ws');
  }

  const searchParams = new URLSearchParams(location.search);
  const relayUrlOverride = searchParams.get('relayUrl');
  if (relayUrlOverride !== null && relayUrlOverride.length > 0) {
    return relayUrlOverride;
  }

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname.length > 0 ? location.hostname : 'localhost';
  return createRelayUrl(host, protocol);
}

export function resolveQrRelayUrl(
  browserRelayUrl: string,
  location: Location | null = getRuntimeLocation(),
): string {
  if (location === null) {
    return browserRelayUrl;
  }

  const searchParams = new URLSearchParams(location.search);
  const qrRelayUrlOverride = searchParams.get('qrRelayUrl');
  if (qrRelayUrlOverride !== null && qrRelayUrlOverride.length > 0) {
    return qrRelayUrlOverride;
  }

  const relayUrlOverride = searchParams.get('relayUrl');
  if (relayUrlOverride !== null && relayUrlOverride.length > 0) {
    return relayUrlOverride;
  }

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return DEFAULT_DEV_QR_RELAY_URL;
  }

  return browserRelayUrl;
}

type PairingStatus =
  | 'connecting'
  | 'waiting_for_scan'
  | 'paired'
  | 'syncing'
  | 'error';

@Component({
  selector: 'app-pairing',
  template: `
    <section class="pairing-screen" role="main" aria-label="Device pairing">
      <div class="pairing-card">
        <header class="pairing-header">
          <h1 class="pairing-title">Chano</h1>
          <p class="pairing-subtitle">Pair with your mobile device</p>
        </header>

        @switch (status()) {
          @case ('connecting') {
            <div class="qr-placeholder" aria-busy="true">
              <div class="spinner" role="status" aria-label="Connecting to relay"></div>
            </div>
          }
          @case ('waiting_for_scan') {
            <div class="qr-container" role="img" aria-label="QR code for device pairing">
              <img [src]="qrDataUrl()" alt="Pairing QR Code" class="qr-image" width="220" height="220" />
            </div>
            <div class="countdown" aria-live="polite">
              <span class="countdown-label">Session expires in</span>
              <span class="countdown-value">{{ countdown() }}</span>
            </div>
          }
          @case ('paired') {
            <div class="paired-container">
              <div class="paired-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>
          }
          @case ('syncing') {
            <div class="qr-placeholder" aria-busy="true">
              <div class="spinner" role="status" aria-label="Syncing data"></div>
            </div>
          }
          @case ('error') {
            <div class="error-container">
              <p class="error-message">{{ errorMessage() }}</p>
              <button class="retry-btn" (click)="retry()">Retry Connection</button>
            </div>
          }
        }

        <div class="status-bar" aria-live="polite">
          <span class="status-dot" [class]="'status-dot--' + status()"></span>
          <span class="status-text">{{ statusText() }}</span>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      height: 100dvh;
      width: 100%;
    }

    .pairing-screen {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100dvh;
      background: #09090b;
      background-image: radial-gradient(ellipse at 50% 0%, rgba(88, 28, 135, 0.12) 0%, transparent 60%);
      padding: 1.5rem;
    }

    .pairing-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.75rem;
      width: 100%;
      max-width: 400px;
      padding: 2.5rem 2rem;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 1.5rem;
    }

    .pairing-header {
      text-align: center;
    }

    .pairing-title {
      font-size: 1.75rem;
      font-weight: 600;
      color: #f5f5f7;
      letter-spacing: -0.025em;
      margin: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .pairing-subtitle {
      font-size: 0.9375rem;
      color: rgba(255, 255, 255, 0.45);
      margin: 0.5rem 0 0;
    }

    .qr-container {
      padding: 1rem;
      background: #fff;
      border-radius: 1rem;
      line-height: 0;
    }

    .qr-image {
      display: block;
      width: 220px;
      height: 220px;
    }

    .qr-placeholder {
      width: 252px;
      height: 252px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 1rem;
      border: 1px dashed rgba(255, 255, 255, 0.08);
    }

    .spinner {
      width: 2.5rem;
      height: 2.5rem;
      border: 3px solid rgba(255, 255, 255, 0.08);
      border-top-color: rgba(255, 255, 255, 0.5);
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .countdown {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }

    .countdown-label {
      color: rgba(255, 255, 255, 0.35);
    }

    .countdown-value {
      color: rgba(255, 255, 255, 0.75);
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }

    .paired-container {
      width: 252px;
      height: 252px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .paired-icon {
      width: 5rem;
      height: 5rem;
      border-radius: 50%;
      background: rgba(34, 197, 94, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #22c55e;
      animation: scale-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .paired-icon svg {
      width: 2.5rem;
      height: 2.5rem;
    }

    @keyframes scale-in {
      from {
        transform: scale(0);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .error-container {
      width: 252px;
      height: 252px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.25rem;
    }

    .error-message {
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.4);
      text-align: center;
      margin: 0;
    }

    .retry-btn {
      padding: 0.625rem 1.5rem;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 0.625rem;
      color: #f5f5f7;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s ease;
      font-family: inherit;
    }

    .retry-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .retry-btn:active {
      background: rgba(255, 255, 255, 0.14);
    }

    .status-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 2rem;
      border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .status-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot--connecting {
      background: #f59e0b;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .status-dot--waiting_for_scan {
      background: #3b82f6;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .status-dot--paired {
      background: #22c55e;
    }

    .status-dot--syncing {
      background: #a855f7;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .status-dot--error {
      background: #ef4444;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.35;
      }
    }

    .status-text {
      font-size: 0.8125rem;
      color: rgba(255, 255, 255, 0.55);
      font-weight: 500;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PairingComponent implements OnInit {
  private readonly relay: WebRelayClient = inject(WebRelayClient);
  private readonly projection = inject(ProjectionStateContainer);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private expiresAtMs = 0;
  private browserRelayUrl = resolveBrowserRelayUrl();
  private qrRelayUrl = resolveQrRelayUrl(this.browserRelayUrl);

  readonly status = signal<PairingStatus>('connecting');
  readonly qrDataUrl = signal('');
  readonly countdown = signal('');
  readonly errorMessage = signal('');

  readonly statusText = computed(() => {
    switch (this.status()) {
      case 'connecting':
        return 'Connecting to relay\u2026';
      case 'waiting_for_scan':
        return 'Scan QR code with Chano mobile';
      case 'paired':
        return 'Connected to Mobile';
      case 'syncing':
        return 'Syncing your data\u2026';
      case 'error':
        return this.errorMessage() || 'Connection error';
    }
  });

  constructor() {
    effect(() => {
      if (this.projection.phase() === 'ready') {
        this.router.navigate(['/explorer']);
      }
    });
  }

  ngOnInit(): void {
    const unsubscribeEnvelope = this.listenForPairingMessages();
    const unsubscribePairApproved = this.listenForPairApproved();
    const unsubscribeState = this.relay.onStateChange((state: 'disconnected' | 'connecting' | 'connected' | 'error') => {
      if (state === 'connected') {
        this.initiateSession();
      }
    });
    const unsubscribeError = this.relay.onError((error: string) => {
      if (this.status() !== 'paired') {
        this.status.set('error');
        this.errorMessage.set(error);
      }
    });

    this.openConnection();
    this.destroyRef.onDestroy(() => {
      unsubscribeEnvelope();
      unsubscribePairApproved();
      unsubscribeState();
      unsubscribeError();
      this.stopCountdown();
    });
  }

  retry(): void {
    this.openConnection();
  }

  // ── Connection ─────────────────────────────────────────────

  private openConnection(): void {
    this.stopCountdown();
    this.status.set('connecting');
    this.errorMessage.set('');
    this.browserRelayUrl = resolveBrowserRelayUrl();
    this.qrRelayUrl = resolveQrRelayUrl(this.browserRelayUrl);
    this.relay.connect(this.browserRelayUrl);
  }

  private initiateSession(): void {
    this.sendQrSessionCreate();
  }

  // ── Message handling ───────────────────────────────────────

  private sendQrSessionCreate(): void {
    const sessionId = this.relay.sessionId();
    const token = this.relay.sessionToken();

    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('INVALID_SESSION_ID');
    }
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('INVALID_SESSION_TOKEN');
    }

    this.relay.sendEnvelope('qr_session_create', { sessionId, token });
  }

  private listenForPairingMessages(): () => void {
    return this.relay.onPairingMessage((envelope: TransportEnvelope) => {
      switch (envelope.type) {
        case 'qr_session_ready':
          void this.onSessionReady(envelope);
          break;
        case 'protocol_handshake':
          this.onProtocolHandshake(envelope);
          break;
        case 'session_close':
          this.onSessionClose(envelope);
          break;
      }
    });
  }

  private listenForPairApproved(): () => void {
    return this.relay.onPairingMessage((envelope: TransportEnvelope) => {
      if (envelope.type === 'pair_approved') {
        this.onPairApproved();
      }
    });
  }

  private async onSessionReady(msg: TransportEnvelope): Promise<void> {
    console.log('RELAY_ACCEPTED type=qr_session_create');

    const sessionId = msg.sessionId;
    const expiresAt = msg.payload?.['expiresAt'];
    const token =
      typeof msg.payload?.['token'] === 'string' && msg.payload['token'].length > 0
        ? msg.payload['token']
        : this.relay.sessionToken();

    if (!sessionId || !expiresAt) return;
    if (typeof token !== 'string' || token.length === 0) {
      this.status.set('error');
      this.errorMessage.set('Missing pairing token');
      return;
    }

    this.expiresAtMs =
      typeof expiresAt === 'number'
        ? expiresAt
        : new Date(String(expiresAt)).getTime();

    const expiresAtIso = new Date(this.expiresAtMs).toISOString();

    const qrPayloadRecord = {
      sessionId,
      token,
      relayUrl: this.qrRelayUrl,
      expiresAt: expiresAtIso,
    };
    const qrPayload = JSON.stringify(qrPayloadRecord);
    console.log('PAIRING_QR_PAYLOAD', qrPayloadRecord);

    try {
      const dataUrl = await QRCode.toDataURL(qrPayload, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
      this.qrDataUrl.set(dataUrl);
      this.status.set('waiting_for_scan');
      this.startCountdown();
    } catch {
      this.status.set('error');
      this.errorMessage.set('Failed to generate QR code');
    }
  }

  private onPairApproved(): void {
    this.stopCountdown();
    this.status.set('paired');
    console.log('PAIR_APPROVED received');
  }

  private onProtocolHandshake(msg: TransportEnvelope): void {
    this.stopCountdown();
    this.status.set('syncing');
    console.log(`PROTOCOL_HANDSHAKE_RECEIVED sessionId=${msg.sessionId ?? 'null'}`);
    console.log(`WEB_SEND protocol_handshake sessionId=${msg.sessionId ?? 'null'}`);
    this.relay.sendEnvelope('protocol_handshake', {
      supportedProtocolVersions: [TRANSPORT_PROTOCOL_VERSION],
      minProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
    });
  }

  private onSessionClose(msg: TransportEnvelope): void {
    this.stopCountdown();
    this.status.set('error');
    this.errorMessage.set(typeof msg.payload['message'] === 'string' ? msg.payload['message'] : 'Session closed');
  }

  // ── Countdown timer ────────────────────────────────────────

  private startCountdown(): void {
    this.stopCountdown();
    this.tickCountdown();

    this.ngZone.runOutsideAngular(() => {
      this.countdownTimer = setInterval(() => {
        this.ngZone.run(() => this.tickCountdown());
      }, 1_000);
    });
  }

  private tickCountdown(): void {
    const remainingMs = Math.max(0, this.expiresAtMs - Date.now());

    if (remainingMs <= 0) {
      this.stopCountdown();
      this.initiateSession();
      return;
    }

    const totalSec = Math.ceil(remainingMs / 1_000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    this.countdown.set(`${mins}:${secs.toString().padStart(2, '0')}`);
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}
