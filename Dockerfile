# воспроизводимая среда: сборка, все тесты и бенчмарк одной командой
#   docker build -t kusok .
#   docker run --rm kusok                # тесты
#   docker run --rm kusok kusok-bench    # эксперименты
FROM ubuntu:24.04
RUN apt-get update -q && apt-get install -y -q --no-install-recommends \
        build-essential cmake ninja-build python3 python3-pip curl && \
    pip3 install --break-system-packages lz4 && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DKUSOK_WERROR=ON && \
    cmake --build build && cmake --install build
CMD ["ctest", "--test-dir", "build", "--output-on-failure"]
