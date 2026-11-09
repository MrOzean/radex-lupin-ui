import { Component, ElementRef, input, output, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { SerialState } from "../../lib/serial";

@Component({
  selector: "app-terminal-dialog",
  imports: [FormsModule],
  template: `
    <dialog #dialog class="terminal-dialog" (click)="backdropClick($event)">
      <header>
        <div><p class="eyebrow">WEB SERIAL</p><h2>Диагностика порта</h2></div>
        <button type="button" class="icon-button" (click)="close()" aria-label="Закрыть">×</button>
      </header>
      <div class="terminal-note">
        Hex-журнал помогает проверить протокол. Не отправляйте неизвестные команды, если прибор выполняет важное измерение.
      </div>
      <pre class="terminal-log">{{ logs().length ? logs().join('\n') : emptyText }}</pre>
      <form class="send-form" (ngSubmit)="send()">
        <input [(ngModel)]="hex" name="hex" spellcheck="false" placeholder="HEX, например: 55 AA 01 00" [disabled]="state() !== 'connected'" />
        <button class="button primary" [disabled]="state() !== 'connected'">Отправить</button>
      </form>
      <footer>
        <button type="button" class="button secondary" (click)="cleared.emit()">Очистить журнал</button>
        <span>921600 бод · 8N1</span>
      </footer>
    </dialog>
  `,
})
export class TerminalDialogComponent {
  readonly logs = input<readonly string[]>([]);
  readonly state = input<SerialState>("disconnected");
  readonly writeHex = output<string>();
  readonly cleared = output<void>();
  readonly emptyText = "Журнал пуст. Подключите Lupin или откройте порт.";
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>("dialog");
  hex = "";

  open(): void {
    this.dialog()?.nativeElement.showModal();
  }

  close(): void {
    this.dialog()?.nativeElement.close();
  }

  backdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  send(): void {
    this.writeHex.emit(this.hex);
  }
}
