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
  styleUrl: "./app.component.css",
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

  exportMeasurement(): void {
    if (this.measurement.exportMeasurement()) this.showToast("Полная запись сохранена");
  }

  async openMeasurementFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await this.measurement.loadFile(file);
      this.showToast(`Открыт архив: ${file.name}`);
    } catch (error) {
      this.showToast(errorMessage(error));
    } finally {
      input.value = "";
    }
  }

  closeFile(): void {
    this.measurement.closeFile();
    this.showToast("Возвращён живой режим");
  }

  formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds - minutes * 60;
    return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleString("ru-RU");
  }

  showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(""), 3500);
  }
}
