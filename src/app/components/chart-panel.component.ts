import { afterNextRender, Component, effect, ElementRef, HostListener, input, OnDestroy, output, signal, viewChild } from "@angular/core";
import type { SampleArray, SpectrumBin } from "../../lib/analysis";
import { SignalChart, SpectrumChart, type SpectrumView } from "../../lib/charts";

@Component({
  selector: "app-chart-panel",
  templateUrl: "./chart-panel.component.html",
  styleUrl: "./chart-panel.component.css",
})
export class ChartPanelComponent implements OnDestroy {
  readonly kind = input.required<"signal" | "spectrum">();
  readonly title = input("");
  readonly description = input("");
  readonly meta = input("");
  readonly samples = input<SampleArray>([]);
  readonly sampleRate = input(2000);
  readonly timeOffset = input(0);
  readonly bins = input<readonly SpectrumBin[]>([]);
  readonly maxFrequency = input(0);
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
      this.timeOffset();
      this.bins();
      this.maxFrequency();
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
      this.chart.update(this.samples(), this.sampleRate(), this.unit(), this.timeOffset());
    } else if (this.kind() === "spectrum" && this.chart instanceof SpectrumChart) {
      this.chart.update(this.bins(), this.maxFrequency());
    }
  }
}
