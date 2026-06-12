import { Injectable } from "@nestjs/common";

@Injectable()
export class RealtimeService {
  private readonly events: Array<{ event: string; payload: unknown; createdAt: string }> = [];

  publish(event: string, payload: unknown) {
    const emitted = {
      event,
      payload,
      createdAt: new Date().toISOString()
    };
    this.events.unshift(emitted);
    this.events.splice(50);
    return emitted;
  }

  recent() {
    return this.events;
  }
}
