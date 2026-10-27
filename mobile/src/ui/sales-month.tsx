import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { FileUp, ListPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { formatRub, reportImportSummary, type SalesMonth } from '@offix/core';
import { fromDocumentAsset } from '../lib/media';
import { isSalesTable, planFactEditable, SALES_FILE_TYPES } from '../lib/sales';
import { salesApi, useSalesEntries, useSalesMutation, useSalesRefresh } from '../lib/sales-api';
import { usePalette } from '../lib/theme';
import { Bar, Button, Card, Empty, SectionTitle, Text } from './primitives';
import { EntryRow, PayoutCard, PlanCard } from './sales';

export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Попробуйте ещё раз');

/** Месяц сотрудника: свой или того, на кого смотрит руководитель (экран сотрудника). */
export function SalesMonthBody({ m, today, self }: { m: SalesMonth; today: string; self: boolean }) {
  const p = usePalette();
  const user = self ? undefined : m.user.id;
  const query = `month=${m.month}${user ? `&user=${user}` : ''}`;
  return (
    <>
      {m.plans.length > 0 && <PayoutCard m={m} />}
      <SectionTitle title="План на месяц" />
      {m.plans.length ? (
        m.plans.map((x) => <PlanCard key={x.id} plan={x} today={today} onFact={planFactEditable(m, x) ? () => router.push(`/sales/fact/${x.id}?${query}`) : undefined} />)
      ) : (
        <Card>
          <Empty
            title="План на месяц не задан"
            text={m.can.edit ? 'Показатели, бонусы и правила выплат ставят на сайте, в разделе «Продажи», — вручную или из файла KPI.' : self ? 'Руководитель ещё не поставил план. Пока можно записывать продажи — они сохранятся за месяцем.' : 'Плана на этот месяц нет.'}
          />
        </Card>
      )}
      {m.can.add_entry && <Button title="Записать продажу" variant="accent" icon={<ListPlus size={18} color={p.accentInk} />} onPress={() => router.push(`/sales/entry?${query}`)} />}
      {self && m.can.reports && <ReportUpload />}
      <Entries month={m.month} user={user} show={m.can.add_entry || m.entries.count > 0} />
    </>
  );
}

/** Отчёт 1С с телефона: выбрать таблицу в «Файлах» — сервер разберёт, пересчитает факт и KPI целей. */
function ReportUpload() {
  const p = usePalette();
  const refresh = useSalesRefresh();
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ReturnType<typeof reportImportSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    const r = await DocumentPicker.getDocumentAsync({ type: [...SALES_FILE_TYPES], copyToCacheDirectory: true, multiple: false });
    const asset = r.canceled ? null : r.assets?.[0];
    if (!asset) return;
    const f = fromDocumentAsset(asset, 0);
    if (!isSalesTable(f.name)) return setError(`«${f.name}» — не таблица. Нужен отчёт 1С в Excel (.xlsx, .xls) или CSV`);
    setProgress(0);
    try {
      const res = await salesApi.uploadReport(f, setProgress);
      setResult(reportImportSummary(res));
      await refresh();
    } catch (e) {
      setError(errText(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Button title={progress != null ? `Загружаю… ${Math.round(progress * 100)} %` : 'Загрузить отчёт 1С'} variant="secondary" loading={progress != null && progress >= 1} disabled={progress != null} icon={<FileUp size={18} color={p.ink} />} onPress={() => void pick()} />
      {progress != null && <Bar percent={progress * 100} color={p.accent} />}
      {error && (
        <Text variant="small" tone="bad">
          {error}
        </Text>
      )}
      {result && (
        <Card style={{ gap: 6, borderColor: result.needsMatching ? p.warn : p.line }}>
          <Text variant="title">{result.title}</Text>
          {result.lines.map((l) => (
            <Text key={l} variant="small" tone="muted">
              {l}
            </Text>
          ))}
        </Card>
      )}
    </View>
  );
}

/** Продажи, записанные вручную или из Excel: своё можно удалить. */
function Entries({ month, user, show }: { month: string; user?: string; show: boolean }) {
  const entries = useSalesEntries(month, user, show);
  const remove = useSalesMutation((id: string) => salesApi.deleteEntry(id));
  if (!show) return null;
  const list = entries.data ?? [];
  const total = list.reduce((s, e) => s + e.amount, 0);
  const ask = (id: string, product: string) =>
    Alert.alert('Удалить продажу?', `«${product}» уйдёт из списка, факт показателя пересчитается.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => remove.mutate(id, { onError: (e) => Alert.alert('Не удалось удалить', errText(e)) }) },
    ]);
  return (
    <>
      <SectionTitle title="Записанные продажи" right={list.length ? <Text variant="caption" tone="faint">{`${list.length} · ${formatRub(total)}`}</Text> : undefined} />
      <Card style={{ paddingVertical: 2 }}>
        {entries.isLoading ? (
          <Text tone="faint" style={{ paddingVertical: 14 }}>
            Загружаю…
          </Text>
        ) : list.length ? (
          list.slice(0, 50).map((e, i) => <EntryRow key={e.id} e={e} first={i === 0} onDelete={() => ask(e.id, e.product)} />)
        ) : (
          <Text variant="small" tone="faint" style={{ paddingVertical: 14 }}>
            За месяц продаж вручную нет. Записывайте продажи, которых нет в отчётах 1С.
          </Text>
        )}
      </Card>
    </>
  );
}
