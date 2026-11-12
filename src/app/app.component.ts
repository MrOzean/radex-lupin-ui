import { Component, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ChartPanelComponent } from "./components/chart-panel.component";
import { LevelGaugeComponent } from "./components/level-gauge.component";
import { TerminalDialogComponent } from "./components/terminal-dialog.component";
import { errorMessage } from "../lib/serial";
import { MeasurementService } from "./services/measurement.service";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

type AppTheme = "dark" | "light";

@Component({
  selector: "app-root",
  imports: [FormsModule, ChartPanelComponent, LevelGaugeComponent, TerminalDialogComponent],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  readonly measurement = inject(MeasurementService);
  readonly serial = this.measurement.serial;
  readonly toast = signal("");
  readonly installAvailable = signal(false);
  readonly theme = signal<AppTheme>(localStorage.getItem("lupin-theme") === "light" ? "light" : "dark");
  private readonly terminal = viewChild(TerminalDialogComponent);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private installPromptEvent: BeforeInstallPromptEvent | null = null;

  constructor() {
    this.applyTheme();
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.installPromptEvent = event as BeforeInstallPromptEvent;
      this.installAvailable.set(true);
    });
    window.addEventListener("appinstalled", () => {
      this.installPromptEvent = null;
      this.installAvailable.set(false);
      this.showToast("Lupin Light Lab установлен");
    });
    this.serial.connectionLoss.subscribe((reason) => {
      this.showToast(`LUPIN отключён: ${reason}. Уже записанные данные сохранены.`);
    });
  }

  toggleTheme(): void {
    this.theme.update((theme) => theme === "dark" ? "light" : "dark");
    this.applyTheme();
  }

  async installApp(): Promise<void> {
    if (!this.installPromptEvent) return;
    await this.installPromptEvent.prompt();
    this.installPromptEvent = null;
    this.installAvailable.set(false);
  }

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

  async ping(): Promise<void> {
    try {
      const response = await this.serial.ping();
      this.showToast(`RPC ping успешен · sequence ${response.sequence}`);
    } catch (error) {
      this.showToast(errorMessage(error));
    }
  }

  async ping9600(): Promise<void> {
    let connectedOnce = false;
    try {
      if (this.serial.state() === "connected") await this.measurement.disconnect();
      await this.serial.connect(9600);
      connectedOnce = true;
      await new Promise((resolve) => setTimeout(resolve, 500));
      let response: { address: number; sequence: number };
      try {
        response = await this.serial.ping(0xff);
      } catch (broadcastError) {
        try {
          response = await this.serial.ping(0);
        } catch (directError) {
          throw new Error(`RPC ping 9600 не отвечает на адреса 0xFF и 0: ${errorMessage(directError)}`);
        }
      }
      this.showToast(`RPC ping 9600 успешен · адрес ${response.address} · sequence ${response.sequence}`);
    } catch (error) {
      if ((error as Error).name !== "NotFoundError") this.showToast(errorMessage(error));
    } finally {
      if (connectedOnce) {
        try {
          await this.serial.disconnect();
          await this.measurement.connect();
        } catch (error) {
          this.showToast(`Не удалось вернуться на 921600: ${errorMessage(error)}`);
        }
      }
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

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme();
    localStorage.setItem("lupin-theme", this.theme());
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", this.theme() === "light" ? "#eef3ef" : "#101a1c");
  }

  showToast(message: string): void {
    this.toast.set(message);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(""), 3500);
  }
}
