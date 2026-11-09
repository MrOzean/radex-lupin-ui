import { afterNextRender, Component, effect, ElementRef, HostListener, input, OnDestroy, output, signal, viewChild } from "@angular/core";
import type { SampleArray, SpectrumBin } from "../../lib/analysis";
import { SignalChart, SpectrumChart, type SpectrumView } from "../../lib/charts";

@Component({
  selector: "app-chart-panel",
  template: `
    @if (expanded()) {
      <div class="chart-backdrop" (click)="toggleExpand()"></div>
    }
    <article class="panel chart-panel" [class.expanded]="expanded()">
      <header class="panel-header">
        <div>
          <h2>{{ title() }}</h2>
          <p>{{ description() }}</p>
        </div>
        <div class="panel-actions">
          @if (kind() === 'signal') {
            <div class="view-switch" aria-label="Единицы измерения">
              <button type="button" [class.active]="unit() === 'лк'" (click)="unitChange.emit('лк')">лк</button>
              <button type="button" [class.active]="unit() === 'кд/м²'" (click)="unitChange.emit('кд/м²')">кд/м²</button>
            </div>
          }
          @if (kind() === 'spectrum') {
            <div class="view-switch" aria-label="Тип спектра">
              <button type="button" [class.active]="spectrumView() === 'bars'" (click)="setView('bars')">Столбцы</button>
              <button type="button" [class.active]="spectrumView() === 'line'" (click)="setView('line')">Линия</button>
              <button type="button" [class.active]="spectrumView() === 'candles'" (click)="setView('candles')">Свечи</button>
            </div>
          }
          <span class="panel-meta">{{ meta() }}</span>
          <button type="button" class="chart-action" (click)="reset()">Сброс</button>
          <button type="button" class="chart-action" (click)="export('png')">PNG</button>
          <button type="button" class="chart-action" (click)="export('svg')">SVG</button>
          <button type="button" class="chart-action expand-action" (click)="toggleExpand()">{{ expanded() ? 'Свернуть' : 'Развернуть' }}</button>
        </div>
      </header>
      <div class="chart-wrap" [class.spectrum]="kind() === 'spectrum'">
        <div #host class="chart"></div>
      </div>
    </article>
  `,
})
export class ChartPanelComponent implements OnDestroy {
  readonly kind = input.required<"signal" | "spectrum">();
  readonly title = input("");
  readonly description = input("");
  readonly meta = input("");
  readonly samples = input<SampleArray>([]);
  readonly sampleRate = input(2000);
  readonly bins = input<readonly SpectrumBin[]>([]);
  readonly unit = input("лк");
  readonly unitChange = output<"лк" | "кд/м²">();
  readonly expanded = signal(false);
  readonly spectrumView = signal<SpectrumView>("bars");
  private readonly host = viewChild<ElementRef<HTMLElement>>("host");
  private chart: SignalChart | SpectrumChart | null = null;

  constructor() {
    effect(() => {
      this.samples();
      this.sampleRate();
      this.bins();
      this.unit();
      this.render();
    });
    afterNextRender(() => {
      const element = this.host()?.nativeElement;
      if (!element) return;
      this.chart = this.kind() === "signal" ? new SignalChart(element) : new SpectrumChart(element);
      this.render();
    });
  }

  setView(view: SpectrumView): void {
    this.spectrumView.set(view);
    if (this.chart instanceof SpectrumChart) this.chart.setView(view);
  }

  toggleExpand(): void {
    this.expanded.update((expanded) => !expanded);
    setTimeout(() => this.chart?.resize(), 0);
  }

  @HostListener("document:keydown.escape")
  closeExpanded(): void {
    if (this.expanded()) this.toggleExpand();
  }

  reset(): void {
    this.chart?.resetZoom();
  }

  export(format: "png" | "svg"): void {
    this.chart?.exportImage(format);
  }

  ngOnDestroy(): void {
    this.chart?.dispose();
  }

  private render(): void {
    if (!this.chart) return;
    if (this.kind() === "signal" && this.chart instanceof SignalChart) {
      this.chart.update(this.samples(), this.sampleRate(), this.unit());
    } else if (this.kind() === "spectrum" && this.chart instanceof SpectrumChart) {
      this.chart.update(this.bins());
    }
  }
}
