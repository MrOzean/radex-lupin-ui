import { Component, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ChartPanelComponent } from "./components/chart-panel.component";
import { TerminalDialogComponent } from "./components/terminal-dialog.component";
import { errorMessage } from "../lib/serial";
import { MeasurementService } from "./services/measurement.service";

@Component({
  selector: "app-root",
  imports: [FormsModule, ChartPanelComponent, TerminalDialogComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent {
  readonly measurement = inject(MeasurementService);
  readonly serial = this.measurement.serial;
  readonly toast = signal("");
  private readonly terminal = viewChild(TerminalDialogComponent);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(): Promise<void> {
    try {
      if (this.serial.state() === "connected") {
        await this.measurement.disconnect();
        this.showToast("LUPIN отключён");
      } else {
        await this.measurement.connect();
        this.showToast("LUPIN подключён. Идёт приём осциллограммы.");
      }
    } catch (error) {
      if ((error as Error).name !== "NotFoundError") this.showToast(errorMessage(error));
    }
  }

  async writeHex(text: string): Promise<void> {
    try {
      await this.serial.writeHex(text);
    } catch (error) {
      this.showToast(errorMessage(error));
    }
  }

  openTerminal(): void {
    this.terminal()?.open();
  }

  exportCsv(): void {
    this.measurement.exportCsv();
  }

  showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(""), 3500);
  }
}
