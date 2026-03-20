import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class WebDeviceIdentity {
  private readonly deviceIdValue = `web-${globalThis.crypto.randomUUID()}`;

  get deviceId(): string {
    return this.deviceIdValue;
  }
}