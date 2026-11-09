import { afterNextRender, Component, effect, ElementRef, input, OnDestroy, viewChild } from "@angular/core";
import type { SampleArray, SpectrumBin } from "../../lib/analysis";
import { SignalChart, SpectrumChart } from "../../lib/charts";

@Component({
  selector: "app-chart-panel",
  template: `
    <article class="panel">
      <header class="panel-header">
        <div>
          <h2>{{ title() }}</h2>
          <p>{{ description() }}</p>
        </div>
        <div class="panel-actions">
          <span class="panel-meta">{{ meta() }}</span>
          <button type="button" class="chart-action" (click)="reset()">Сброс</button>
          <button type="button" class="chart-action" (click)="export('png')">PNG</button>
          <button type="button" class="chart-action" (click)="export('svg')">SVG</button>
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
  private readonly host = viewChild<ElementRef<HTMLElement>>("host");
  private chart: SignalChart | SpectrumChart | null = null;

  constructor() {
    effect(() => {
      this.samples();
      this.sampleRate();
      this.bins();
      this.render();
    });
    afterNextRender(() => {
      const element = this.host()?.nativeElement;
      if (!element) return;
      this.chart = this.kind() === "signal" ? new SignalChart(element) : new SpectrumChart(element);
      this.render();
    });
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
      this.chart.update(this.samples(), this.sampleRate());
    } else if (this.kind() === "spectrum" && this.chart instanceof SpectrumChart) {
      this.chart.update(this.bins());
    }
  }
}
