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
import { ProjectionStore } from '../projection/projection.store';
import { WebRelayClient } from '../../transport';
import type { TransportEnvelope } from '../../transport';

const RELAY_URL = 'ws://localhost:8080/relay';

type PairingStatus =
  | 'connecting'
  | 'waiting_for_scan'
  | 'paired'
  | 'syncing'
  | 'error';

@Component({
  selector: 'app-pairing',
  templateUrl: './pairing.html',
  styleUrl: './pairing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PairingComponent implements OnInit {
  private readonly relay: WebRelayClient = inject(WebRelayClient);
  private readonly projection = inject(ProjectionStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

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
    const unsubscribeEnvelope = this.relay.onEnvelope((envelope: TransportEnvelope) => this.handleMessage(envelope));
    const unsubscribeState = this.relay.onStateChange((state: 'disconnected' | 'connecting' | 'connected' | 'error') => {
      if (state === 'connected') {
        this.requestNewSession();
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
    this.relay.connect(RELAY_URL);
  }

  private requestNewSession(): void {
    const envelope = this.relay.createEnvelope('qr_session_create');
    this.relay.sendEnvelope(envelope);
  }

  // ── Message handling ───────────────────────────────────────

  private handleMessage(msg: TransportEnvelope): void {
    switch (msg.type) {
      case 'qr_session_ready':
        void this.onSessionReady(msg);
        break;
      case 'pair_approved':
        this.onPairApproved();
        break;
      case 'snapshot_start':
        this.status.set('syncing');
        break;
    }
  }

  private async onSessionReady(msg: TransportEnvelope): Promise<void> {
    const sessionId = msg.sessionId;
    const expiresAt = msg.payload?.['expiresAt'];

    if (!sessionId || !expiresAt) return;

    this.expiresAtMs =
      typeof expiresAt === 'number'
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
}
