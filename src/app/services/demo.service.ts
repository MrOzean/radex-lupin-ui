import { Injectable, signal } from "@angular/core";
import { Subject } from "rxjs";
import { DemoSource, type DemoChunk } from "../../lib/demo";

@Injectable({ providedIn: "root" })
export class DemoService {
  private readonly source = new DemoSource();
  readonly running = signal(false);
  readonly packets = new Subject<DemoChunk>();

  constructor() {
    this.source.addEventListener("data", (event) => {
      this.packets.next((event as CustomEvent<DemoChunk>).detail);
    });
  }

  start(): void {
    this.source.start();
    this.running.set(true);
  }

  stop(): void {
    this.source.stop();
    this.running.set(false);
  }
}
