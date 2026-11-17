# Lupin Light Lab

Неофициальный современный веб-интерфейс для люксметра-пульсметра-яркомера **RADEX LUPIN**.

## Статус

Базовый live-режим уже работает с реальным LUPIN через Web Serial: пакеты `OSCILLOSCOPE`, показания освещённости, коэффициент пульсации, осциллограмма и FFT подтверждены на приборе. Есть demo-режим, пауза без закрытия порта, переключаемый НЧ-фильтр, полный спектр 0…3000 Гц, запись CSV и ограниченный диагностический HEX-журнал. Полные записи сохраняются в `.lupinlab` (float32 + метаданные) и открываются без прибора с навигацией по истории. Команды управления и чтение конфигурации устройства ещё исследуются.

Подробный отчёт с доказательствами и границами текущих знаний: [docs/research/radexlight-protocol.ru.md](docs/research/radexlight-protocol.ru.md).

Описание бинарной записи: [docs/file-format.ru.md](docs/file-format.ru.md).

Текущее состояние и план следующих этапов: [docs/project-status.ru.md](docs/project-status.ru.md).

## Запуск

```powershell
npm install
npm run dev
```

Сборка и тесты:

```powershell
npm run build
npm test
npm run preview
```

Для подключения нужен Chrome/Edge и HTTPS или `localhost`. Web Serial недоступен в Firefox/Safari; на iOS потребуется другой транспорт.

## PWA и офлайн

Production-сборка является устанавливаемым PWA. После первого открытия интерфейс, ECharts и архивный анализ работают без сети. Для установки используйте кнопку в верхней панели или штатный пункт Chrome/Edge «Установить приложение». Service worker включается только в production-режиме.

## Публикация и релизы

- **GitHub Pages**: push в `master` автоматически собирает и публикует приложение (workflow `.github/workflows/pages.yml`). Требуется включить Pages в настройках репозитория (Source: GitHub Actions).
- **Релизы**: тег `v*` запускает `.github/workflows/release.yml`, который прикрепляет к GitHub Release:
  - `lupin-light-lab-web-<tag>.zip` — статический бандл для любого веб-сервера;
  - `lupin-coeffs-<platform>.zip/tar.gz` — утилита чтения коэффициентов калибровки для Windows, macOS (intel/arm) и Linux (amd64/arm64);
  - `lupin-light-lab-src-<tag>.zip` — архив исходников;
  - `sha256sums.txt` — контрольные суммы.

## Утилита коэффициентов

`tools/lupin-coeffs/` — автономная программа на Go, читает заводскую калибровку LUPIN (делитель яркости lumDiv и множитель) из USB-серийного номера, недоступного браузеру. Запустите один раз и введите значения в поля приложения:

```powershell
go build -C tools/lupin-coeffs -o lupin-coeffs.exe .
.\tools\lupin-coeffs\lupin-coeffs.exe
```

## Технологии

- **Angular 22.2**, standalone-компоненты, signals и zoneless change detection;
- **ECharts 6** — легенда, tooltip, масштабирование, pan, экспорт PNG/SVG;
- Web Serial API, TypeScript 6, RxJS.

## Структура

- `src/app/services/measurement.service.ts` — состояние измерения, пауза, статистика, FFT и запись;
- `src/app/services/serial.service.ts` — Web Serial, пакеты LUPIN и ограниченный журнал;
- `src/app/services/demo.service.ts` — виртуальный источник;
- `src/app/components/chart-panel.component.ts` — жизненный цикл и управление ECharts;
- `src/app/components/terminal-dialog.component.ts` — диагностический HEX-терминал;
- `src/lib/lupin.ts` — инкрементальный разбор пакетов `OSCILLOSCOPE`;
- `src/lib/analysis.ts` — статистика, коэффициент пульсации, FFT, доминирующие частоты;
- `research/` — инструменты read-only анализа официального ПО;
- `docs/research/` — результаты исследования.
