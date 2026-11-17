// Repro: does the signal-chart tooltip pipeline throw? Dispatch showTip in SSR.
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  SVGRenderer,
]);

const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 800, height: 400 });
const points = Array.from({ length: 6000 }, (_, i) => [i / 6000, 100 + Math.sin(i / 10)]);
const average = points.map(([t]) => [t, 100]);
chart.setOption({
  animation: false,
  grid: { left: 58, right: 22, top: 50, bottom: 67 },
  legend: { top: 4, right: 8 },
  tooltip: {
    trigger: "axis",
    axisPointer: { type: "line", lineStyle: { color: "#61776f" } },
    formatter: (params) => {
      const items = params;
      const rows = items.map((item) => {
        const value = item.value.length >= 5 ? item.value[2] : item.value[1];
        return `${item.seriesName}: ${value.toFixed(2)}`;
      }).join(" | ");
      return `t=${items[0].value[0].toFixed(3)} ${rows}`;
    },
  },
  dataZoom: [
    { type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false },
    { type: "slider", xAxisIndex: 0, filterMode: "none", height: 18, bottom: 10 },
  ],
  xAxis: { type: "value", min: 0, max: 1 },
  yAxis: { type: "value", scale: true },
  series: [
    { name: "Сигнал", type: "line", data: points, showSymbol: false, sampling: "lttb", emphasis: { disabled: true } },
    { name: "Среднее", type: "line", data: average, showSymbol: false, emphasis: { disabled: true } },
  ],
});

try {
  chart.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: 3000 });
  console.log("showTip OK");
} catch (error) {
  console.log("showTip THREW:", error.message);
}
try {
  chart.dispatchAction({ type: "updateAxisPointer", currTrigger: "mousemove", x: 400, y: 200 });
  console.log("updateAxisPointer OK");
} catch (error) {
  console.log("updateAxisPointer THREW:", error.message);
}
console.log("render:", chart.renderToSVGString().length, "bytes");
chart.dispose();
