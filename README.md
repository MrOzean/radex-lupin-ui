# Lupin Light Lab

Неофициальный современный веб-интерфейс для люксметра-пульсметра-яркомера **RADEX LUPIN**.

## Статус

Базовый live-режим уже работает с реальным LUPIN через Web Serial: пакеты `OSCILLOSCOPE`, показания освещённости, коэффициент пульсации, осциллограмма и FFT подтверждены на приборе. Есть demo-режим, запись CSV и ограниченный диагностический HEX-журнал. Команды управления и чтение конфигурации устройства ещё исследуются.

Подробный отчёт с доказательствами и границами текущих знаний: [docs/research/radexlight-protocol.ru.md](docs/research/radexlight-protocol.ru.md).

## Запуск

```powershell
npm install
npm run dev
```

Сборка:

```powershell
npm run build
npm run preview
```

Для подключения нужен Chrome/Edge и HTTPS или `localhost`. Web Serial недоступен в Firefox/Safari; на iOS потребуется другой транспорт.

## Структура

- `src/lib/serial.ts` — Web Serial, фильтр LUPIN `ABBA:E011`, RX/TX HEX-журнал;
- `src/lib/analysis.ts` — статистика, коэффициент пульсации, FFT, доминирующие частоты;
- `src/lib/charts.ts` — Canvas-графики;
- `src/lib/demo.ts` — виртуальный источник, не связанный с прибором;
- `research/` — инструменты read-only анализа официального ПО;
- `docs/research/` — результаты исследования.
