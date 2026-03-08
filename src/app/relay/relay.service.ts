import { Injectable, inject, signal, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import type { RelayEnvelope } from './relay.models';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

@Injectable({ providedIn: 'root' })
export class RelayService {
  private readonly ngZone = inject(NgZone);
  private ws: WebSocket | null = null;

  private readonly _messages = new Subject<RelayEnvelope>();
  private readonly _connected = new Subject<void>();
  private readonly _connectionError = new Subject<string>();

  readonly state = signal<ConnectionState>('disconnected');
  readonly messages$: Observable<RelayEnvelope> = this._messages.asObservable();
  readonly connected$: Observable<void> = this._connected.asObservable();
  readonly connectionError$: Observable<string> = this._connectionError.asObservable();

  connect(url: string): void {
    this.disconnect();
    this.state.set('connecting');

    this.ngZone.runOutsideAngular(() => {
      const ws = new WebSocket(url);

      ws.onopen = () =>
        this.ngZone.run(() => {
          this.state.set('connected');
          this._connected.next();
        });

      ws.onmessage = (event: MessageEvent) =>
        this.ngZone.run(() => {
          try {
            const msg: RelayEnvelope = JSON.parse(String(event.data));
            if (msg.type) this._messages.next(msg);
          } catch {
            // ignore malformed frames
          }
        });

      ws.onerror = () =>
        this.ngZone.run(() => {
          this.state.set('error');
          this._connectionError.next('Failed to connect to relay server');
        });

      ws.onclose = () =>
        this.ngZone.run(() => {
          if (this.state() !== 'disconnected' && this.state() !== 'error') {
            this.state.set('error');
            this._connectionError.next('Connection to relay lost');
          }
        });

      this.ws = ws;
    });
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
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
    this.state.set('disconnected');
  }
}
