import {
  Component,
  OnInit,
  signal,
  computed,
  DestroyRef,
  inject,
  ChangeDetectionStrategy,
  NgZone,
} from '@angular/core';
import QRCode from 'qrcode';

const RELAY_URL = 'ws://172.20.10.3:8080';

type PairingStatus = 'connecting' | 'waiting_for_scan' | 'paired' | 'error';

interface RelayEnvelope {
  type: string;
  sessionId: string | null;
  timestamp: number;
  payload: Record<string, unknown>;
}

@Component({
  selector: 'app-pairing',
  templateUrl: './pairing.html',
  styleUrl: './pairing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PairingComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  private ws: WebSocket | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private expiresAtMs = 0;

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
      case 'error':
        return this.errorMessage() || 'Connection error';
    }
  });

  ngOnInit(): void {
    this.openConnection();
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  /** Retry connection from the UI after an error. */
  retry(): void {
    this.openConnection();
  }

  // ── WebSocket lifecycle ────────────────────────────────────

  private openConnection(): void {
    this.cleanup();
    this.status.set('connecting');

    this.ngZone.runOutsideAngular(() => {
      const ws = new WebSocket(RELAY_URL);

      ws.onopen = () =>
        this.ngZone.run(() => this.requestNewSession());

      ws.onmessage = (event: MessageEvent) =>
        this.ngZone.run(() => this.handleMessage(event));

      ws.onerror = () =>
        this.ngZone.run(() => {
          this.status.set('error');
          this.errorMessage.set('Failed to connect to relay server');
        });

      ws.onclose = () =>
        this.ngZone.run(() => {
          if (this.status() !== 'paired' && this.status() !== 'error') {
            this.status.set('error');
            this.errorMessage.set('Connection to relay lost');
          }
        });

      this.ws = ws;
    });
  }

  private requestNewSession(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'qr_session_create' }));
    }
  }

  // ── Message handling ───────────────────────────────────────

  private handleMessage(event: MessageEvent): void {
    let msg: RelayEnvelope;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return; // ignore malformed frames
    }

    if (!msg.type) return;

    switch (msg.type) {
      case 'qr_session_ready':
        void this.onSessionReady(msg);
        break;
      case 'pair_approved':
        this.onPairApproved();
        break;
    }
  }

  private async onSessionReady(msg: RelayEnvelope): Promise<void> {
    const sessionId = msg.sessionId;
    const expiresAt = msg.payload?.['expiresAt'];

    if (!sessionId || !expiresAt) return;

    // Relay sends expiresAt as epoch ms
    this.expiresAtMs = typeof expiresAt === 'number'
      ? expiresAt
      : new Date(String(expiresAt)).getTime();

    const expiresAtIso = new Date(this.expiresAtMs).toISOString();

    const qrPayload = JSON.stringify({
      sessionId,
      relayUrl: RELAY_URL,
      expiresAt: expiresAtIso,
    });

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
      this.requestNewSession();
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

  // ── Cleanup ────────────────────────────────────────────────

  private cleanup(): void {
    this.stopCountdown();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;

      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}
