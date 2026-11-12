import * as echarts from "echarts/core";
import { BarChart, CandlestickChart, LineChart } from "echarts/charts";
import {
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { signalStats, type SampleArray, type SpectrumBin } from "./analysis";
import { downloadText } from "./recording";

echarts.use([
  LineChart,
  BarChart,
  CandlestickChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  CanvasRenderer,
  SVGRenderer,
]);

const COLORS = {
  text: "#819590",
  grid: "rgba(154, 181, 176, 0.12)",
  line: "#c8f76b",
  average: "#70d6c2",
  threshold: "#e6b86a",
};

interface TooltipItem {
  seriesName: string;
  marker: string;
  value: number[];
}

function tooltipHtml(params: unknown, xUnit: string, yUnit: string, yOffset = 0): string {
  const items = params as TooltipItem[];
  if (!Array.isArray(items) || items.length === 0) return "";
  const rows = items.map((item) => {
    const value = item.value.length >= 5 ? item.value[2] : item.value[1] - yOffset;
    return `<div style="display:flex;gap:18px;justify-content:space-between;margin-top:5px">` +
      `<span>${item.marker}${item.seriesName}</span><strong>${value.toFixed(2)} ${yUnit}</strong></div>`;
  }).join("");
  return `<div>Время/частота: <strong>${items[0].value[0].toFixed(3)} ${xUnit}</strong></div>${rows}`;
}

function baseOption(xDecimals = 2): EChartsCoreOption {
  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 58, right: 22, top: 50, bottom: 67, containLabel: false },
    legend: {
      top: 4,
      right: 8,
      textStyle: { color: COLORS.text, fontSize: 10 },
      itemWidth: 16,
      itemHeight: 7,
      inactiveColor: "#475852",
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(9, 17, 19, 0.96)",
      borderColor: "#354640",
      textStyle: { color: "#e8eeea", fontSize: 11 },
      axisPointer: { type: "cross", lineStyle: { color: "#61776f" }, crossStyle: { color: "#61776f" } },
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
      },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: 18,
        bottom: 10,
        borderColor: "transparent",
        backgroundColor: "rgba(154, 181, 176, 0.035)",
        fillerColor: "rgba(112, 214, 194, 0.12)",
        handleStyle: { color: "#70d6c2", borderColor: "#70d6c2" },
        moveHandleStyle: { color: "#5b756c" },
        textStyle: { color: COLORS.text, fontSize: 9 },
        labelFormatter: (value: number) => Number(value.toFixed(xDecimals)).toString(),
        dataBackground: { lineStyle: { color: "#50675e" }, areaStyle: { color: "rgba(112, 214, 194, .05)" } },
        selectedDataBackground: { lineStyle: { color: COLORS.average }, areaStyle: { color: "rgba(112, 214, 194, .1)" } },
      },
    ],
  };
}

abstract class BaseChart {
  protected readonly chart: EChartsType;
  private readonly observer: ResizeObserver;
  private resizeFrame: number | null = null;
  private readonly windowResizeListener = (): void => this.scheduleResize();

  constructor(host: HTMLElement, private readonly exportName: string) {
    this.chart = echarts.init(host, undefined, { renderer: "canvas" });
    this.observer = new ResizeObserver(() => this.scheduleResize());
    this.observer.observe(host);
    if (host.parentElement) this.observer.observe(host.parentElement);
    window.addEventListener("resize", this.windowResizeListener, { passive: true });
  }

  private scheduleResize(): void {
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.chart.resize();
    });
  }

  resetZoom(): void {
    this.chart.dispatchAction({ type: "dataZoom", start: 0, end: 100 });
  }

  resize(): void {
    this.chart.resize();
  }

  dispose(): void {
    this.observer.disconnect();
    window.removeEventListener("resize", this.windowResizeListener);
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.chart.dispose();
  }

  exportImage(format: "png" | "svg"): void {
    const filename = `${this.exportName}-${new Date().toISOString().replaceAll(":", "-")}.${format}`;
    if (format === "png") {
      const link = document.createElement("a");
      link.href = this.chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#131e20" });
      link.download = filename;
      link.click();
      return;
    }

    const rect = this.chart.getDom().getBoundingClientRect();
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${rect.width}px;height:${rect.height}px`;
    document.body.appendChild(host);
    const svgChart = echarts.init(host, undefined, { renderer: "svg", width: rect.width, height: rect.height });
    try {
      svgChart.setOption(this.chart.getOption() as EChartsCoreOption);
      const svg = host.querySelector("svg");
      if (!svg) throw new Error("Не удалось создать SVG");
      downloadText(new XMLSerializer().serializeToString(svg), filename, "image/svg+xml;charset=utf-8");
    } finally {
      svgChart.dispose();
      host.remove();
    }
  }
}

export class SignalChart extends BaseChart {
  constructor(host: HTMLElement) {
    super(host, "lupin-signal");
  }

  update(samples: SampleArray, sampleRate: number, unit = "лк", timeOffset = 0): void {
    const points: [number, number][] = [];
    for (let i = 0; i < samples.length; i++) points.push([timeOffset + i / sampleRate, samples[i]]);
    const stats = signalStats(samples);
    const average = points.map(([time]) => [time, stats.mean] as [number, number]);

    this.chart.setOption({
      ...baseOption(),
      xAxis: {
        type: "value",
        name: "Время, с",
        nameLocation: "middle",
        nameGap: 26,
        min: timeOffset,
        max: timeOffset + Math.max(1 / sampleRate, (samples.length - 1) / sampleRate),
        axisLabel: { color: COLORS.text, fontSize: 10, formatter: (value: number) => value.toFixed(2) },
        nameTextStyle: { color: COLORS.text, fontSize: 9 },
        axisLine: { lineStyle: { color: "#354640" } },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
      yAxis: {
        type: "value",
        name: unit,
        scale: true,
        axisLabel: { color: COLORS.text, fontSize: 10 },
        nameTextStyle: { color: COLORS.text },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
      tooltip: { valueFormatter: undefined },
      series: [
        {
          name: "Сигнал",
          type: "line",
          data: points,
          showSymbol: false,
          sampling: "lttb",
          lineStyle: { color: COLORS.line, width: 1.5 },
          itemStyle: { color: COLORS.line },
          areaStyle: { color: "rgba(200, 247, 107, 0.055)" },
          emphasis: { disabled: true },
        },
        {
          name: "Среднее",
          type: "line",
          data: average,
          showSymbol: false,
          lineStyle: { color: COLORS.average, width: 1.2, type: "dashed" },
          itemStyle: { color: COLORS.average },
          emphasis: { disabled: true },
        },
      ],
    } as EChartsCoreOption);

    this.chart.setOption({
      tooltip: { formatter: (params: unknown) => tooltipHtml(params, "с", unit) },
    });
  }
}

export type SpectrumView = "line" | "bars" | "candles";

export class SpectrumChart extends BaseChart {
  private bins: readonly SpectrumBin[] = [];
  private view: SpectrumView = "bars";

  constructor(host: HTMLElement) {
    super(host, "lupin-spectrum");
  }

  setView(view: SpectrumView): void {
    if (this.view === view) return;
    this.view = view;
    this.chart.clear();
    this.update(this.bins);
  }

  update(bins: readonly SpectrumBin[]): void {
    this.bins = bins;
    const points = bins.map((bin) => [bin.frequency, bin.decibels] as [number, number]);
    const bars = this.view === "bars";
    const valueOffset = bars ? 100 : 0;
    const displayPoints = points.map(([frequency, decibels]) => [frequency, decibels + valueOffset]);
    const threshold = points.map(([frequency]) => [frequency, -40 + valueOffset]);
    const candles = bins.map((bin, index) => {
      const open = bins[index - 1]?.decibels ?? bin.decibels;
      const next = bins[index + 1]?.decibels ?? bin.decibels;
      return [
        bin.frequency,
        open,
        bin.decibels,
        Math.min(open, bin.decibels, next),
        Math.max(open, bin.decibels, next),
      ];
    });

    const spectrumSeries = this.view === "candles" ? {
      name: "Спектр",
      type: "candlestick",
      data: candles,
      barWidth: "65%",
      itemStyle: {
        color: "rgba(112, 214, 194, .6)",
        color0: "rgba(200, 247, 107, .5)",
        borderColor: COLORS.average,
        borderColor0: COLORS.line,
      },
    } : {
      name: "Спектр",
      type: bars ? "bar" : "line",
      data: displayPoints,
      showSymbol: false,
      barWidth: "70%",
      lineStyle: { color: COLORS.average, width: 1.5 },
      itemStyle: { color: COLORS.average },
      areaStyle: bars ? undefined : { color: "rgba(112, 214, 194, 0.08)" },
      emphasis: { disabled: true },
    };

    this.chart.setOption({
      ...baseOption(),
      xAxis: {
        type: "value",
        name: "Частота, Гц",
        nameLocation: "middle",
        nameGap: 26,
        min: 0,
        max: Math.max(1, bins.at(-1)?.frequency ?? 3000),
        axisLabel: { color: COLORS.text, fontSize: 10, formatter: (value: number) => value.toFixed(0) },
        nameTextStyle: { color: COLORS.text, fontSize: 9 },
        axisLine: { lineStyle: { color: "#354640" } },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
      yAxis: {
        type: "value",
        name: "дБ",
        min: bars ? 0 : -100,
        max: bars ? 100 : 0,
        axisLabel: {
          color: COLORS.text,
          fontSize: 10,
          formatter: (value: number) => String(value - valueOffset),
        },
        nameTextStyle: { color: COLORS.text },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
      series: [
        spectrumSeries,
        {
          name: "Порог −40 дБ",
          type: "line",
          data: threshold,
          showSymbol: false,
          lineStyle: { color: COLORS.threshold, width: 1, type: "dashed" },
          itemStyle: { color: COLORS.threshold },
          emphasis: { disabled: true },
        },
      ],
    } as EChartsCoreOption);

    this.chart.setOption({
      tooltip: { formatter: (params: unknown) => tooltipHtml(params, "Гц", "дБ", valueOffset) },
    });
  }
}
