cmake_minimum_required(VERSION 3.16)
project(kusok VERSION 0.5.0 LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "" FORCE)
endif()

option(KUSOK_SANITIZE "собрать с AddressSanitizer и UBSan" OFF)
option(KUSOK_WERROR "предупреждения = ошибки" OFF)
option(KUSOK_FUZZ "собрать фаззеры libFuzzer (нужен clang)" OFF)
option(KUSOK_COVERAGE "собрать с покрытием (gcov)" OFF)
option(KUSOK_TESTS "собрать тесты" ON)
option(KUSOK_NODE "собрать привязку для node.js (нужен node)" OFF)

set(KUSOK_WARN -Wall -Wextra -Wpedantic -Wshadow -Wstrict-prototypes
    -Wmissing-prototypes -Wpointer-arith -Wcast-qual -Wvla)
if(KUSOK_WERROR)
  list(APPEND KUSOK_WARN -Werror)
endif()

if(KUSOK_SANITIZE)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer
                      -fno-sanitize-recover=all)
  add_link_options(-fsanitize=address,undefined)
endif()
if(KUSOK_FUZZ)
  # библиотеку тоже инструментируем, иначе фаззер не видит покрытие внутри неё
  add_compile_options(-fsanitize=fuzzer-no-link,address,undefined
                      -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()
if(KUSOK_COVERAGE)
  # atomic: счётчики из нескольких потоков
  add_compile_options(--coverage -O0 -fprofile-update=atomic)
  add_link_options(--coverage)
endif()

find_package(Threads REQUIRED)

add_library(kusok STATIC
  src/bundle.c
  src/cache.c
  src/cdc.c
  src/crc32c.c
  src/fsck.c
  src/fsutil.c
  src/gc.c
  src/idx.c
  src/journal.c
  src/lz.c
  src/manifest.c
  src/pack.c
  src/pool.c
  src/sha256.c
  src/store.c
  src/tab.c
  src/util.c
)
target_include_directories(kusok
  PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
         $<INSTALL_INTERFACE:include>
  PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_options(kusok PRIVATE ${KUSOK_WARN})
target_link_libraries(kusok PUBLIC Threads::Threads)
set_target_properties(kusok PROPERTIES POSITION_INDEPENDENT_CODE ON)

add_executable(kusok-cli tools/kusok.c tools/http.c tools/serve.c)
set_target_properties(kusok-cli PROPERTIES OUTPUT_NAME kusok)
target_include_directories(kusok-cli PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(kusok-cli PRIVATE kusok)
target_compile_options(kusok-cli PRIVATE ${KUSOK_WARN})

add_executable(kusok-bench tools/bench.c)
target_include_directories(kusok-bench PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(kusok-bench PRIVATE kusok)
target_compile_options(kusok-bench PRIVATE ${KUSOK_WARN})

install(TARGETS kusok kusok-cli kusok-bench)

if(KUSOK_NODE)
  find_program(NODE node REQUIRED)
  # заголовки N-API лежат рядом с самим node
  execute_process(
    COMMAND ${NODE} -p "require('path').resolve(process.execPath, '../../include/node')"
    OUTPUT_VARIABLE NODE_INC OUTPUT_STRIP_TRAILING_WHITESPACE)
  if(NOT EXISTS ${NODE_INC}/node_api.h)
    message(FATAL_ERROR "нет node_api.h в ${NODE_INC}")
  endif()
  add_library(kusok_node MODULE bindings/node/kusok_node.c)
  set_target_properties(kusok_node PROPERTIES PREFIX "" SUFFIX ".node"
                        OUTPUT_NAME kusok C_VISIBILITY_PRESET hidden)
  target_include_directories(kusok_node PRIVATE ${NODE_INC})
  target_link_libraries(kusok_node PRIVATE kusok)
  # макрос NAPI_MODULE объявляет функции без прототипов
  target_compile_options(kusok_node PRIVATE ${KUSOK_WARN} -Wno-missing-prototypes)
  if(APPLE)
    target_link_options(kusok_node PRIVATE -undefined dynamic_lookup)
  endif()
endif()
install(FILES include/kusok/kusok.h DESTINATION include/kusok)

if(KUSOK_TESTS)
  enable_testing()
  set(KUSOK_UNIT_TESTS
    test_bytes test_sha256 test_crc32c test_cdc test_lz test_tab test_pool test_idx test_cache test_http test_bundle
    test_manifest test_pack test_journal test_store test_read
    test_refs test_gc test_recovery test_fsck test_mutate)
  foreach(t ${KUSOK_UNIT_TESTS})
    add_executable(${t} tests/${t}.c tests/tt.c)
    target_include_directories(${t} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src
                                            ${CMAKE_CURRENT_SOURCE_DIR}/tests)
    target_link_libraries(${t} PRIVATE kusok)
    target_compile_options(${t} PRIVATE ${KUSOK_WARN})
    add_test(NAME ${t} COMMAND ${t})
  endforeach()
  target_sources(test_http PRIVATE tools/http.c)
  target_include_directories(test_http PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tools)
  add_test(NAME serve COMMAND sh ${CMAKE_CURRENT_SOURCE_DIR}/tests/serve_test.sh
           $<TARGET_FILE:kusok-cli>)
  set_tests_properties(serve PROPERTIES SKIP_RETURN_CODE 77)
  add_test(NAME cli COMMAND sh ${CMAKE_CURRENT_SOURCE_DIR}/tests/cli_test.sh
                                $<TARGET_FILE:kusok-cli>)
  if(KUSOK_NODE)
    add_test(NAME node COMMAND ${NODE} --test
             ${CMAKE_CURRENT_SOURCE_DIR}/bindings/node/test.js)
    set_tests_properties(node PROPERTIES
                         ENVIRONMENT KUSOK_NODE_ADDON=$<TARGET_FILE:kusok_node>)
  endif()
  find_package(Python3 COMPONENTS Interpreter QUIET)
  if(Python3_FOUND)
    # совместимость с эталонным lz4; без pip-пакета lz4 тест пропускается
    add_test(NAME lz4_interop
             COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/interop_lz4.py)
    set_tests_properties(lz4_interop PROPERTIES SKIP_RETURN_CODE 77)
  endif()
endif()

if(KUSOK_FUZZ)
  foreach(f fuzz_lz fuzz_manifest fuzz_pack fuzz_roundtrip fuzz_idx fuzz_http fuzz_bundle)
    add_executable(${f} tests/fuzz/${f}.c)
    target_include_directories(${f} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
    target_compile_options(${f} PRIVATE -fsanitize=fuzzer,address,undefined)
    target_link_options(${f} PRIVATE -fsanitize=fuzzer,address,undefined)
    target_link_libraries(${f} PRIVATE kusok)
  endforeach()
  target_sources(fuzz_http PRIVATE tools/http.c)
  target_include_directories(fuzz_http PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tools)
endif()
