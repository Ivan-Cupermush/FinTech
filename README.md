# kusok

[![ci](https://github.com/Ivan-Cupermush/viewed_for_Yadro/actions/workflows/ci.yml/badge.svg)](https://github.com/Ivan-Cupermush/viewed_for_Yadro/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

kusok — хранилище файлов, которое не хранит одно и то же дважды.
Библиотека и утилита на C11, без внешних зависимостей.

Зачем: на сервере [offix](https://github.com/Ivan-Cupermush/FinTech) одно
вложение пересылают в пять чатов, документ загружают десятью версиями с
правкой в паре строк, выгрузка из 1С приходит каждую неделю почти та же.
Сейчас каждый раз на диск ложится полная копия. kusok хранит только то,
чего ещё не было.

> *English:* a deduplicating file store in C11 — FastCDC chunking, SHA-256
> addressing, LZ4-compatible compression, append-only packs with a refcount
> journal, crash-safe by design. Built for the offix server.

## Как это работает

Файл режется на куски по 2–64 КБ. Каждый кусок получает имя — свой
SHA-256. Если кусок с таким именем уже есть, второй раз он не пишется.
Сам файл — это просто список имён его кусков.

## Алгоритмы

| что | зачем |
|---|---|
| **FastCDC** — резка по содержимому: граница там, где «скользящий» хеш последних байт даёт нужный узор | вставка в середину файла меняет 1–2 куска, а не все после неё, как при кусках одинаковой длины |
| **SHA-256** (с инструкциями SHA-NI, если есть) | имя куска; подделать кусок с чужим именем нельзя |
| **CRC32C** (с инструкцией SSE4.2) | быстро заметить испорченную запись на диске |
| **LZ4** — свой кодек в формате блока LZ4, режимы «быстро» и «сильнее» (уровни 2–12, поиск по цепочкам хешей) | сжатие кусков; файл совместим с настоящим lz4 |
| **хеш-таблица** с открытой адресацией | найти кусок по имени за O(1) |
| **бинарный поиск** по списку кусков | прочитать файл с любого места (HTTP Range, перемотка видео) |
| **журнал + снимок** счётчиков ссылок | файл удаляется, когда на него больше никто не ссылается, и это переживает сбой |
| **mark-compact** сборка мусора | освободить место от удалённых кусков |
| **пул потоков** | хеш и сжатие на всех ядрах; результат тот же, что в один поток |
| **LRU-кэш** | частые чтения одного места не распаковывают кусок заново |

Данные только дописываются в конец файлов, а порядок записи и `fsync`
подобран так, что после отключения питания в любой момент хранилище
открывается целым. Подробно — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Сборка

Нужны gcc или clang, CMake и Linux (или другая POSIX-система).

```sh
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

Или `docker build -t kusok . && docker run --rm kusok`.

## Как пользоваться

```sh
kusok /srv/files put report.pdf          # положить, выведет id
kusok /srv/files get ID copy.pdf         # достать
kusok /srv/files cat ID 4096 100         # 100 байт со смещения 4096
kusok /srv/files rm ID                   # минус одна ссылка
kusok /srv/files gc                      # убрать мусор
kusok /srv/files fsck                    # проверить всё
kusok /srv/files serve 127.0.0.1:8090    # HTTP: GET/PUT/DELETE /f/ID, Range
kusok /backup ids > have                 # бэкап: передать только новое
ssh vps kusok /srv/files export - have | kusok /backup import -
```

Из C — [include/kusok/kusok.h](include/kusok/kusok.h), из Node.js —
[bindings/node](bindings/node) (сборка с `-DKUSOK_NODE=ON`):

```js
const { Kusok } = require('./bindings/node');
const ks = new Kusok('/srv/files');
const { id } = await ks.putFile('/tmp/upload');
const part = await ks.read(id, 0, 65536);
```

## Что получилось

- место на сценариях offix сократилось в 5 раз, на версиях одного документа
  — в 48 раз (у кусков одинаковой длины — в 1,4 раза), на истории
  репозитория offix — в 4–6 раз ([docs/EXPERIMENTS.md](docs/EXPERIMENTS.md));
- запись 150–290 МБ/с (зависит от числа потоков), чтение из кэша — доли микросекунды;
- 155 тестов, тест обрыва записи в 372 точках, 7 фаззеров, ASan, valgrind,
  покрытие 90,6%; всё это гоняет CI на каждом коммите.

## Документация

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — устройство и формат на диске;
- [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) — замеры и как их повторить;
- [docs/INTEGRATION.md](docs/INTEGRATION.md) — как kusok встаёт в offix.

## Ограничения

- один `kusok *` — один поток снаружи (внутри свой пул);
- только POSIX, под Windows — через WSL;
- шифрования нет.

## Лицензия

MIT, см. [LICENSE](LICENSE).
