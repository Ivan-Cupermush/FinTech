import { Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { todayIso } from '@offix/core';
import { useGoals } from '../../lib/queries';
import { Button } from '../../ui/Button';
import { Empty, Skeleton, Tabs } from '../../ui/Misc';
import { GoalTile } from './parts';

type Tab = 'active' | 'mine' | 'drafts' | 'all';

const FILTERS: Record<Tab, string> = {
  active: 'scope=top&status=active',
  mine: 'owner=me',
  drafts: 'status=draft',
  all: 'scope=top',
};

const EMPTY: Record<Tab, { title: string; text: string }> = {
  active: { title: 'Активных целей нет', text: 'Создайте цель с измеримым результатом или активируйте черновик.' },
  mine: { title: 'Вы пока не владелец ни одной цели', text: 'Владелец отвечает за результат. Цели, где вы владелец, появятся здесь.' },
  drafts: { title: 'Черновиков нет', text: 'Черновик сохраняется, даже если KPI или срок ещё не известны.' },
  all: { title: 'Целей пока нет', text: 'Начните с одной цели — например, «Сократить время согласования заявки с 40 до 30 минут».' },
};

export function GoalsPage() {
  const [tab, setTab] = useState<Tab>('active');
  const navigate = useNavigate();
  const goals = useGoals(FILTERS[tab]);
  const today = todayIso();
  const list = (goals.data ?? []).filter((g) => tab !== 'all' || g.status !== 'cancelled');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Цели</h1>
          <p className="muted">Каждая цель — это показатель, который должен измениться, и путь к нему.</p>
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/app/goals/new')}>
          Новая цель
        </Button>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Tabs
          label="Фильтр целей"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: 'В работе' },
            { value: 'mine', label: 'Мои' },
            { value: 'drafts', label: 'Черновики' },
            { value: 'all', label: 'Все' },
          ]}
        />
      </div>
      {goals.isLoading ? (
        <div className="grid-cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card stack">
              <Skeleton h={14} w="40%" />
              <Skeleton h={22} w="80%" />
              <Skeleton h={36} />
            </div>
          ))}
        </div>
      ) : goals.isError ? (
        <div className="card">
          <Empty title="Не удалось загрузить цели" action={<Button onClick={() => goals.refetch()}>Повторить</Button>}>
            {(goals.error as Error).message}
          </Empty>
        </div>
      ) : list.length ? (
        <div className="grid-cards">
          {list.map((g) => (
            <GoalTile key={g.id} goal={g} today={today} />
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={<Target size={22} />} title={EMPTY[tab].title} action={<Button variant="primary" onClick={() => navigate('/app/goals/new')}>Создать цель</Button>}>
            {EMPTY[tab].text}
          </Empty>
        </div>
      )}
    </div>
  );
}
