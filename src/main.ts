import "./style.css";
import { dominantFrequencies, powerSpectrum, signalStats, type SpectrumBin } from "./lib/analysis";
import { SignalChart, SpectrumChart } from "./lib/charts";
import { DemoSource, type DemoChunk } from "./lib/demo";
import { LupinStreamParser } from "./lib/lupin";
import { downloadText, Recording } from "./lib/recording";
import { errorMessage, hexDump, SerialConnection, type SerialLogEntry, type SerialState } from "./lib/serial";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const icons = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  plug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-6 6v4M9 21h6"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  record: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 18v3h16v-3"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 7 4 4-4 4M11 16h8"/></svg>',
  wave: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h3l3-8 4 16 3-12 3 8h4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};

const app = byId("app");
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="Lupin Light Lab">
        <span class="brand-mark">${icons.sun}</span>
        <span><strong>LUPIN</strong><small>LIGHT LAB</small></span>
      </a>
      <div class="topbar-center"><span class="workspace-dot"></span>Рабочее место <span class="muted">/</span> Световая среда</div>
      <div class="topbar-actions">
        <span id="connection-badge" class="status-badge demo"><span></span>Демо-режим</span>
        <button id="terminal-open" class="icon-button" title="Диагностика COM-порта">${icons.terminal}</button>
        <button id="connect" class="button primary">${icons.plug}<span>Подключить</span></button>
      </div>
    </header>

    <main class="workspace">
      <section class="page-heading">
        <div><p class="eyebrow">ИЗМЕРЕНИЕ СВЕТОВОЙ СРЕДЫ</p><h1>Картина света. <span>В реальном времени.</span></h1></div>
        <div class="heading-actions">
          <button id="stream-toggle" class="button secondary">${icons.stop}<span>Пауза</span></button>
          <button id="record-toggle" class="button secondary">${icons.record}<span>Начать запись</span></button>
        </div>
      </section>

      <section class="metrics" aria-label="Текущие показания">
        <article class="metric-card metric-main">
          <div class="metric-label"><span>ОСВЕЩЁННОСТЬ</span><span id="live-tag" class="live-tag"><i></i>LIVE</span></div>
          <div class="metric-value"><strong id="lux-value">—</strong><span>лк</span></div>
          <div class="comfort-track"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="metric-footer"><span>Интегральное среднее</span><strong id="lux-avg">— лк</strong></div>
        </article>
        <article class="metric-card">
          <div class="metric-label"><span>КОЭФФИЦИЕНТ ПУЛЬСАЦИИ</span>${icons.wave}</div>
          <div class="metric-value"><strong id="flicker-value">—</strong><span>%</span></div>
          <div class="metric-footer"><span>Диапазон</span><strong id="signal-range">—</strong></div>
        </article>
        <article class="metric-card">
          <div class="metric-label"><span>ДОМИНИРУЮЩАЯ ЧАСТОТА</span><span class="small-orbit"></span></div>
          <div class="metric-value"><strong id="frequency-value">—</strong><span>Гц</span></div>
          <div id="frequency-list" class="frequency-list"><span>Нет данных</span></div>
        </article>
      </section>

      <section class="dashboard-grid">
        <div class="charts-column">
          <article class="panel">
            <header class="panel-header"><div><h2>Осциллограмма</h2><p>Колесо — масштаб · перетаскивание — движение · наведение — значения</p></div><div class="panel-actions"><span class="panel-meta">до 6000 Гц · 2048 точек</span><button class="chart-action" data-chart="signal" data-action="reset">Сброс</button><button class="chart-action" data-chart="signal" data-action="png">PNG</button><button class="chart-action" data-chart="signal" data-action="svg">SVG</button></div></header>
            <div class="chart-wrap"><div id="signal-chart" class="chart"></div></div>
          </article>
          <article class="panel">
            <header class="panel-header"><div><h2>Спектр пульсаций</h2><p>Амплитуда частотных составляющих · легенда кликабельна</p></div><div class="panel-actions"><span class="panel-meta">дБ · 0–500 Гц</span><button class="chart-action" data-chart="spectrum" data-action="reset">Сброс</button><button class="chart-action" data-chart="spectrum" data-action="png">PNG</button><button class="chart-action" data-chart="spectrum" data-action="svg">SVG</button></div></header>
            <div class="chart-wrap spectrum"><div id="spectrum-chart" class="chart"></div></div>
          </article>
        </div>

        <aside class="side-column">
          <article class="panel session-panel">
            <header class="panel-header"><div><h2>Параметры сеанса</h2><p>Настройки текущего измерения</p></div></header>
            <label class="field"><span>Тип измерения</span><select id="measurement-type"><option value="illuminance">Освещённость, лк</option><option value="luminance" disabled>Яркость, кд/м² · скоро</option></select></label>
            <label class="field"><span>Корректирующий множитель</span><div class="input-with-action"><input id="correction" type="number" value="1.000" min="0.001" max="100" step="0.001"/><button id="correction-reset" title="Сбросить">1×</button></div></label>
            <label class="field"><span>Комментарий к измерению</span><textarea id="comment" rows="3" placeholder="Например: рабочее место у окна"></textarea></label>
            <div class="session-info"><span>Источник</span><strong id="source-name">Виртуальный светильник</strong></div>
            <div class="session-info"><span>Частота дискретизации</span><strong id="sample-rate">2 000 Гц</strong></div>
          </article>
          <article class="panel export-panel">
            <div class="recording-state"><span id="recording-dot" class="recording-dot"></span><div><strong id="recording-title">Запись не ведётся</strong><small id="recording-count">0 точек сохранено</small></div></div>
            <button id="export" class="button secondary full" disabled>${icons.download}<span>Экспорт CSV</span></button>
          </article>
          <article id="browser-note" class="browser-note" hidden></article>
        </aside>
      </section>
      <footer class="page-footer"><span>LUPIN LIGHT LAB · неофициальный кроссплатформенный интерфейс</span><span>Web Serial API · локально, без сервера</span></footer>
    </main>
  </div>

  <dialog id="terminal-dialog" class="terminal-dialog">
    <header><div><p class="eyebrow">WEB SERIAL</p><h2>Диагностика порта</h2></div><button id="terminal-close" class="icon-button">${icons.close}</button></header>
    <div class="terminal-note">Hex-журнал помогает проверить протокол. Не отправляйте неизвестные команды, если прибор выполняет важное измерение.</div>
    <pre id="terminal-log">Журнал пуст. Подключите Lupin или откройте порт.</pre>
    <form id="send-form" class="send-form"><input id="send-hex" spellcheck="false" placeholder="HEX, например: 55 AA 01 00" disabled/><button class="button primary" disabled>Отправить</button></form>
    <footer><button id="terminal-clear" class="button secondary">Очистить журнал</button><span id="port-settings">921600 бод · 8N1</span></footer>
  </dialog>
  <div id="toast" class="toast" role="status"></div>
`;

const signalChart = new SignalChart(byId("signal-chart"));
const spectrumChart = new SpectrumChart(byId("spectrum-chart"));
const demo = new DemoSource();
const serial = new SerialConnection();
const lupin = new LupinStreamParser();
const recording = new Recording();
const charts = { signal: signalChart, spectrum: spectrumChart };
const samples = new Float32Array(2048);
let sampleCount = 0;
let correction = 1;
let latestSpectrum: SpectrumBin[] = [];
let streamPaused = false;
let lastRecorded = 0;
let toastTimer: ReturnType<typeof setTimeout>;

function toast(message: string): void {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 3500);
}

function updateConnection(state: SerialState): void {
  const badge = byId("connection-badge");
  badge.className = `status-badge ${state === "connected" ? "connected" : state === "connecting" ? "connecting" : ""}`;
  badge.innerHTML = `<span></span>${state === "connected" ? "Порт открыт" : state === "connecting" ? "Подключение…" : "Не подключено"}`;
  byId<HTMLButtonElement>("connect").innerHTML = state === "connected" ? `${icons.close}<span>Отключить</span>` : `${icons.plug}<span>Подключить</span>`;
  byId<HTMLButtonElement>("connect").disabled = state === "connecting";
  byId<HTMLInputElement>("send-hex").disabled = state !== "connected";
  byId<HTMLButtonElement>("send-form").querySelector("button")!.disabled = state !== "connected";
  byId("source-name").textContent = state === "connected" ? "RADEX LUPIN · live" : "Виртуальный светильник";
  byId("sample-rate").textContent = state === "connected" ? "6 000 Гц" : "2 000 Гц";
  if (state !== "connected") streamPaused = false;
  updateStreamControl();
}

function updateStreamControl(): void {
  const live = serial.state === "connected" ? !streamPaused : demo.running;
  byId<HTMLButtonElement>("stream-toggle").innerHTML = live
    ? `${icons.stop}<span>Пауза</span>`
    : `${icons.play}<span>Продолжить</span>`;
  byId("live-tag").innerHTML = `<i></i>${live ? "LIVE" : "PAUSE"}`;
  if (serial.state === "connected") {
    byId("source-name").textContent = streamPaused ? "RADEX LUPIN · пауза" : "RADEX LUPIN · live";
    if (streamPaused) {
      byId("connection-badge").className = "status-badge";
      byId("connection-badge").innerHTML = "<span></span>Пауза · порт открыт";
    }
  } else {
    byId("connection-badge").className = `status-badge ${demo.running ? "demo" : ""}`;
    byId("connection-badge").innerHTML = `<span></span>${demo.running ? "Демо-режим" : "Остановлено"}`;
  }
}

function processChunk(chunk: DemoChunk): void {
  const corrected = chunk.samples.map((value) => value * correction);
  if (corrected.length >= samples.length) {
    samples.set(corrected.slice(-samples.length));
    sampleCount = samples.length;
  } else {
    samples.copyWithin(0, corrected.length);
    samples.set(corrected, samples.length - corrected.length);
    sampleCount = Math.min(samples.length, sampleCount + corrected.length);
  }

  const visible = samples.subarray(samples.length - sampleCount);
  const stats = signalStats(visible);
  latestSpectrum = powerSpectrum(visible, chunk.sampleRate);
  const dominant = dominantFrequencies(latestSpectrum);
  byId("lux-value").textContent = stats.mean.toFixed(1);
  byId("lux-avg").textContent = `${stats.mean.toFixed(1)} лк`;
  byId("flicker-value").textContent = stats.flickerPercent.toFixed(1);
  byId("signal-range").textContent = `${stats.minimum.toFixed(1)}…${stats.maximum.toFixed(1)} лк`;
  byId("frequency-value").textContent = dominant[0] ? dominant[0].frequency.toFixed(0) : "—";
  byId("frequency-list").innerHTML = dominant.length
    ? dominant.map((bin, index) => `<span><i>${index + 1}</i>${bin.frequency.toFixed(0)} Гц <strong>${bin.decibels.toFixed(0)} дБ</strong></span>`).join("")
    : "<span>Нет выраженных пиков</span>";
  signalChart.update(visible, chunk.sampleRate);
  spectrumChart.update(latestSpectrum);

  const now = Date.now();
  if (recording.active && now - lastRecorded >= 250) {
    recording.add({
      timestamp: chunk.timestamp.toISOString(),
      illuminanceLux: stats.mean,
      flickerPercent: stats.flickerPercent,
      dominantFrequencyHz: dominant[0]?.frequency ?? 0,
    });
    lastRecorded = now;
    byId("recording-count").textContent = `${recording.count} точек сохранено`;
    byId<HTMLButtonElement>("export").disabled = recording.count === 0;
  }
}

demo.addEventListener("data", (event) => processChunk((event as CustomEvent<DemoChunk>).detail));
lupin.addEventListener("packet", (event) => {
  if (streamPaused) return;
  const chunk = (event as CustomEvent<DemoChunk>).detail;
  console.debug("LUPIN packet", {
    first: chunk.samples[0],
    last: chunk.samples.at(-1),
    minimum: Math.min(...chunk.samples),
    maximum: Math.max(...chunk.samples),
  });
  processChunk(chunk);
});
serial.addEventListener("data", (event) => lupin.push((event as CustomEvent<Uint8Array>).detail));
serial.addEventListener("state", (event) => updateConnection((event as CustomEvent<SerialState>).detail));
const terminalLines: string[] = [];
let terminalFlush: ReturnType<typeof setTimeout> | null = null;

function flushTerminal(): void {
  terminalFlush = null;
  const log = byId("terminal-log");
  log.textContent = terminalLines.join("\n") || "Журнал пуст. Подключите Lupin или откройте порт.";
  log.scrollTop = log.scrollHeight;
}

serial.addEventListener("log", (event) => {
  const entry = (event as CustomEvent<SerialLogEntry>).detail;
  const content = typeof entry.data === "string" ? entry.data : hexDump(entry.data);
  const prefix = entry.direction === "rx" ? "RX" : entry.direction === "tx" ? "TX" : "··";
  terminalLines.push(`${entry.timestamp.toLocaleTimeString("ru-RU")} ${prefix}  ${content}`);
  if (terminalLines.length > 200) terminalLines.splice(0, terminalLines.length - 200);
  if (terminalFlush === null) terminalFlush = setTimeout(flushTerminal, 150);
});

document.querySelectorAll<HTMLButtonElement>(".chart-action").forEach((button) => {
  button.addEventListener("click", () => {
    const chart = charts[button.dataset.chart as keyof typeof charts];
    const action = button.dataset.action;
    if (action === "reset") chart.resetZoom();
    else if (action === "png" || action === "svg") chart.exportImage(action);
  });
});

byId("stream-toggle").addEventListener("click", () => {
  if (serial.state === "connected") streamPaused = !streamPaused;
  else if (demo.running) demo.stop();
  else demo.start();
  updateStreamControl();
});

byId("connect").addEventListener("click", async () => {
  try {
    if (serial.state === "connected") await serial.disconnect();
    else {
      demo.stop();
      streamPaused = false;
      lupin.reset();
      await serial.connect();
      toast("LUPIN подключён. Идёт приём осциллограммы.");
    }
  } catch (error) {
    if ((error as Error).name !== "NotFoundError") toast(errorMessage(error));
  }
});

byId("record-toggle").addEventListener("click", () => {
  if (recording.active) recording.stop();
  else {
    recording.start();
    lastRecorded = 0;
  }
  byId<HTMLButtonElement>("record-toggle").innerHTML = recording.active ? `${icons.stop}<span>Остановить запись</span>` : `${icons.record}<span>Начать запись</span>`;
  byId("recording-title").textContent = recording.active ? "Идёт запись" : "Запись остановлена";
  byId("recording-dot").classList.toggle("active", recording.active);
  byId<HTMLButtonElement>("export").disabled = recording.count === 0;
});

byId("export").addEventListener("click", () => {
  if (recording.count === 0) return;
  const comment = byId<HTMLTextAreaElement>("comment").value.trim();
  const prefix = comment ? `# ${comment}\r\n` : "";
  downloadText(prefix + recording.toCsv(), `lupin-${new Date().toISOString().replaceAll(":", "-")}.csv`);
});

byId("correction").addEventListener("change", () => {
  const value = byId<HTMLInputElement>("correction").valueAsNumber;
  if (Number.isFinite(value) && value > 0) correction = value;
  else byId<HTMLInputElement>("correction").value = correction.toFixed(3);
});
byId("correction-reset").addEventListener("click", () => {
  correction = 1;
  byId<HTMLInputElement>("correction").value = "1.000";
});

const terminal = byId<HTMLDialogElement>("terminal-dialog");
byId("terminal-open").addEventListener("click", () => terminal.showModal());
byId("terminal-close").addEventListener("click", () => terminal.close());
terminal.addEventListener("click", (event) => {
  if (event.target === terminal) terminal.close();
});
byId("terminal-clear").addEventListener("click", () => {
  terminalLines.length = 0;
  if (terminalFlush !== null) clearTimeout(terminalFlush);
  terminalFlush = null;
  byId("terminal-log").textContent = "";
});
byId("send-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const input = byId<HTMLInputElement>("send-hex");
    const bytes = input.value.trim().split(/[\s,]+/).filter(Boolean).map((part) => {
      if (!/^[0-9a-fA-F]{1,2}$/.test(part)) throw new Error(`Некорректный байт: ${part}`);
      return Number.parseInt(part, 16);
    });
    if (bytes.length === 0) return;
    await serial.write(new Uint8Array(bytes));
  } catch (error) {
    toast(errorMessage(error));
  }
});

if (!SerialConnection.supported()) {
  const note = byId("browser-note");
  note.hidden = false;
  note.innerHTML = "<strong>Web Serial недоступен</strong><br>Для подключения прибора используйте Chrome или Edge. Демо-режим и анализ данных работают без ограничений.";
  byId<HTMLButtonElement>("connect").disabled = true;
}

demo.start();
