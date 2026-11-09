import { CircleCheck, Download, FileSpreadsheet, KeyRound, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  compactPeopleRows,
  credentialsCsv,
  guessPeopleColumns,
  parseTable,
  peoplePlanSummary,
  peopleTemplateCsv,
  plural,
  COMPANY_ROLE_LABELS,
  PEOPLE_FIELD_LABELS,
  PEOPLE_IMPORT_MAX_ROWS,
  type ImportedCredential,
  type PeopleField,
  type PeopleMapping,
  type PeoplePlan,
  type PeopleRow,
} from '@offix/core';
import { api, ApiError, saveBlob } from '../../lib/api';
import { uploadPeopleTable } from '../../lib/files';
import { readTextFile } from '../goals/ImportDialog';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Dialog } from '../../ui/Misc';
import { Pill } from '../../ui/Pill';
import './org.css';

const PEOPLE = ['сотрудника', 'сотрудника', 'сотрудников'] as const;
const UNITS_FORMS = ['подразделение', 'подразделения', 'подразделений'] as const;
/** Порядок полей в форме: сначала обязательное, ФИО по частям — в конце. */
const FIELDS: PeopleField[] = ['name', 'email', 'position', 'unit', 'manager', 'role', 'last_name', 'first_name', 'middle_name'];
const STATUS: Record<PeopleRow['status'], { label: string; tone: 'good' | 'neutral' | 'bad' }> = {
  new: { label: 'Добавим', tone: 'good' },
  exists: { label: 'Уже в компании', tone: 'neutral' },
  error: { label: 'Ошибка', tone: 'bad' },
};
const TEXT_FILE = /\.(csv|tsv|txt)$/i;

interface ImportResult {
  plan: PeoplePlan;
  created: number;
  units_created: number;
  credentials: ImportedCredential[];
}

/** Значение, которое меняется не чаще, чем раз в `ms`: вставку печатают, а не только вставляют. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const errorText = (e: unknown) => {
  if (e instanceof ApiError) return Object.values(e.fields ?? {})[0] ?? e.message;
  return (e as Error).message;
};

/**
 * Импорт сотрудников и структуры из Excel или CSV. Пилоту не нужно вводить
 * сто человек руками: файл → колонки → проверка каждой строки сервером →
 * одна транзакция. Подразделения из пути «Институт / Кафедра» создаются
 * сами, временные пароли выдаются один раз файлом.
 */
export function ImportPeople({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [override, setOverride] = useState<Partial<PeopleMapping>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const table = useMemo(() => parseTable(text), [text]);
  const guessed = useMemo(() => guessPeopleColumns(table.columns, table.rows, table.hasHeader), [table]);
  const mapping = useMemo(() => ({ ...guessed, ...override }) as PeopleMapping, [guessed, override]);
  const hasName = mapping.name >= 0 || mapping.last_name >= 0 || mapping.first_name >= 0;
  const ready = table.rows.length > 0 && mapping.email >= 0 && hasName;
  const payload = useMemo(() => (ready ? compactPeopleRows(table.rows, table.lines, mapping) : null), [ready, table, mapping]);
  const settled = useSettled(payload, 350);
  const preview = useQuery({
    queryKey: ['people-import', settled],
    queryFn: () => api<{ plan: PeoplePlan }>('/users/import', { body: { ...settled, dry_run: true } }),
    enabled: !!settled && settled === payload,
    staleTime: Infinity,
    gcTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const plan = payload ? preview.data?.plan : undefined;

  const reset = (next: string, name: string | null) => {
    setText(next);
    setFileName(name);
    setOverride({});
    setError(null);
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      // CSV читаем сами (UTF-8 или windows-1251), Excel разбирает сервер.
      reset(TEXT_FILE.test(file.name) ? await readTextFile(file) : (await uploadPeopleTable(file)).text, file.name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setReading(false);
    }
  };

  const submit = async () => {
    if (!payload || !plan?.counts.new) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api<ImportResult>('/users/import', { body: { ...payload, dry_run: false } });
      setResult(r);
      await Promise.all(['users', 'units', 'security', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e) {
      setError(errorText(e));
      void preview.refetch();
    } finally {
      setSaving(false);
    }
  };

  const savePasswords = () => {
    if (!result) return;
    saveBlob(new Blob([credentialsCsv(result.credentials, window.location.origin)], { type: 'text/csv;charset=utf-8' }), 'offix-пароли.csv');
    setSaved(true);
  };
  const close = () => {
    if (result && !saved && !askClose) return setAskClose(true);
    onClose();
  };

  if (result) {
    const n = result.created;
    return (
      <Dialog
        wide
        title="Сотрудники добавлены"
        onClose={close}
        footer={
          <>
            <Button variant={saved ? 'ghost' : 'primary'} icon={<Download size={14} />} onClick={savePasswords}>
              Скачать пароли
            </Button>
            <Button variant={saved ? 'primary' : 'ghost'} onClick={close}>
              Готово
            </Button>
          </>
        }
      >
        <div className="pim-done" role="status">
          <CircleCheck size={22} aria-hidden />
          <div>
            <b>
              Добавили {n} {plural(n, PEOPLE)}
              {result.units_created ? ` и ${result.units_created} ${plural(result.units_created, UNITS_FORMS)}` : ''}
            </b>
            <span className="muted">Каждый входит по своей почте и временному паролю, а потом меняет пароль в профиле.</span>
          </div>
        </div>
        <div className={askClose ? 'pim-keys is-alert' : 'pim-keys'} role={askClose ? 'alert' : undefined}>
          <KeyRound size={18} aria-hidden />
          <span>
            {askClose
              ? 'Пароли ещё не скачаны. После закрытия окна их не увидит никто, даже администратор: придётся сбрасывать каждому. Закрыть всё равно?'
              : 'Пароли видны только сейчас. В offix они хранятся только в зашифрованном виде, поэтому скачайте файл и раздайте его лично.'}
          </span>
        </div>
        <div className="import-table-wrap pim-table">
          <table className="import-table">
            <thead>
              <tr>
                <th scope="col">Сотрудник</th>
                <th scope="col">Логин</th>
                <th scope="col">Временный пароль</th>
              </tr>
            </thead>
            <tbody>
              {result.credentials.map((c) => (
                <tr key={c.email}>
                  <td>{c.name}</td>
                  <td className="pim-mono">{c.email}</td>
                  <td className="pim-mono">{c.password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    );
  }

  const columns = table.columns;
  const pick = (f: PeopleField, v: number) => setOverride((o) => ({ ...o, [f]: v }));
  const hidden = (f: PeopleField) => (f === 'last_name' || f === 'first_name' || f === 'middle_name') && mapping[f] < 0 && mapping.name >= 0;

  return (
    <Dialog
      wide
      title="Сотрудники из Excel"
      onClose={close}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<Download size={14} />}
            style={{ marginRight: 'auto' }}
            onClick={() => saveBlob(new Blob([peopleTemplateCsv()], { type: 'text/csv;charset=utf-8' }), 'offix-сотрудники.csv')}
          >
            Скачать образец
          </Button>
          <Button variant="primary" loading={saving} disabled={!plan?.counts.new || preview.isFetching} onClick={submit}>
            {plan?.counts.new ? `Добавить ${plan.counts.new} ${plural(plan.counts.new, PEOPLE)}` : 'Добавить сотрудников'}
          </Button>
        </>
      }
    >
      <p className="muted pim-lead">
        Нужны ФИО и почта. Подразделение пишите путём: «Институт экономики / Кафедра финансов» — чего нет, создадим. В колонке «Руководитель» — «да» у главы подразделения. До {PEOPLE_IMPORT_MAX_ROWS}{' '}
        строк за раз.
      </p>

      <div
        className={drag ? 'pim-drop is-drag' : 'pim-drop'}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void onFile(e.dataTransfer.files?.[0]);
        }}
      >
        <FileSpreadsheet size={26} aria-hidden />
        <div className="pim-drop-text">
          <b>{fileName ?? 'Перетащите файл .xlsx или .csv'}</b>
          <span className="faint">{fileName ? `${table.rows.length} ${plural(table.rows.length, ['строка', 'строки', 'строк'])}` : 'Выгрузка из 1С, кадровой системы или просто таблица'}</span>
        </div>
        <Button size="sm" icon={<Upload size={14} />} loading={reading} onClick={() => fileRef.current?.click()}>
          Выбрать файл
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt"
          hidden
          aria-label="Файл с сотрудниками"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <Field label="Или вставьте ячейки из таблицы">
        {(p) => (
          <textarea
            className="textarea import-paste"
            {...p}
            rows={text ? 4 : 3}
            spellCheck={false}
            placeholder={'ФИО\tПочта\tПодразделение\nПетров Иван\tpetrov@uni.ru\tИнститут экономики'}
            value={text}
            onChange={(e) => reset(e.target.value, null)}
          />
        )}
      </Field>

      {table.rows.length > 0 && (
        <section className="pim-cols" aria-label="Колонки файла">
          {FIELDS.filter((f) => !hidden(f)).map((f) => (
            <Field key={f} label={PEOPLE_FIELD_LABELS[f]}>
              {(p) => (
                <select className="select" {...p} value={mapping[f]} onChange={(e) => pick(f, Number(e.target.value))}>
                  <option value={-1}>{f === 'email' ? 'Выберите колонку' : 'Нет в файле'}</option>
                  {columns.map((c, i) => (
                    <option key={i} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ))}
        </section>
      )}

      {table.rows.length > 0 && !ready && (
        <div className="field-error" role="alert">
          {mapping.email < 0 ? 'Выберите колонку с почтой: по ней сотрудник входит в offix.' : 'Выберите колонку с ФИО или с фамилией и именем.'}
        </div>
      )}

      {preview.isError && payload && <div className="field-error" role="alert">{errorText(preview.error)}</div>}

      {plan && (
        <section className="stack pim-plan" style={{ '--gap': '12px' } as React.CSSProperties} aria-label="Предпросмотр импорта" aria-busy={preview.isFetching}>
          <div className="pim-summary" role="status">
            <b>{peoplePlanSummary(plan)}</b>
            {plan.truncated && <span className="pim-warn">Взяли первые {PEOPLE_IMPORT_MAX_ROWS} строк — остальное загрузите вторым файлом.</span>}
          </div>
          {plan.units.length > 0 && (
            <div className="pim-units">
              <span className="faint">Новые подразделения:</span>
              {plan.units.map((u) => (
                <span key={u.path.join('/')} className="pim-unit" title={u.path.join(' / ')}>
                  {u.path.length > 1 && <span className="faint">{u.path.slice(0, -1).join(' / ')} / </span>}
                  {u.name}
                </span>
              ))}
            </div>
          )}
          <div className="import-table-wrap pim-table">
            <table className="import-table">
              <thead>
                <tr>
                  <th scope="col" className="import-line">Стр.</th>
                  <th scope="col">Сотрудник</th>
                  <th scope="col">Подразделение и роль</th>
                  <th scope="col">Статус</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.line} className={r.status === 'error' ? 'import-error' : undefined}>
                    <td className="import-line faint num">{r.line}</td>
                    <td>
                      <span className="import-status">{r.name || '—'}</span>
                      <span className="import-reason pim-mono">{r.email || 'без почты'}</span>
                    </td>
                    <td>
                      <span className="pim-path">{r.unit_path.length ? r.unit_path.join(' / ') : '—'}</span>
                      <span className="import-reason">
                        {r.is_manager && r.role === 'manager' ? 'Глава подразделения' : COMPANY_ROLE_LABELS[r.role]}
                        {r.is_manager && r.role !== 'manager' ? ' · глава подразделения' : ''}
                        {r.position ? ` · ${r.position}` : ''}
                      </span>
                    </td>
                    <td>
                      <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                      {r.note && r.status !== 'exists' && <span className="import-reason">{r.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {error && (
        <div className="field-error row" role="alert" style={{ gap: 6 }}>
          <TriangleAlert size={14} aria-hidden /> {error}
        </div>
      )}
    </Dialog>
  );
}
