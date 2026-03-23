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

const RELAY_URL = 'ws://172.20.10.3:8080/relay';
const TRANSPORT_PROTOCOL_VERSION = 2;

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
  private readonly projection = inject(ProjectionStateContainer);
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
    this.relay.connect(RELAY_URL);
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
      relayUrl: RELAY_URL,
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
