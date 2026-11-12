import { Component, ElementRef, input, output, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { SerialState } from "../../lib/serial";

@Component({
  selector: "app-terminal-dialog",
  imports: [FormsModule],
  templateUrl: "./terminal-dialog.component.html",
  styleUrl: "./terminal-dialog.component.css",
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
