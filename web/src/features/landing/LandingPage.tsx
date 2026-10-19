import { ArrowRight, Ban, CalendarClock, Gauge, GitBranch, Lock, Route, ShieldCheck, Target, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { kpiProgress } from '@offix/core';
import { KpiTrack } from '../../ui/KpiTrack';
import { Logo } from '../../ui/Logo';
import './landing.css';

const STEPS = [
  { icon: Target, title: 'Сформулируйте результат', text: 'Не «провести анализ», а «сократить время согласования с 40 до 30 минут». Мастер подскажет, где цель превращается в задачу.' },
  { icon: Route, title: 'Разложите путь', text: 'Цель → подцели → задачи с зависимостями. offix сам найдёт критический путь — цепочку, которая определяет срок.' },
  { icon: Gauge, title: 'Смотрите на цифру', text: 'Прогресс — это движение KPI, а не процент закрытых задач. Нет замера — честное «Нет данных», без фиктивных процентов.' },
];

const SCENARIOS = [
  { letter: 'A', icon: Ban, title: 'Задача заблокирована', text: 'Причина, с какого дня и что нужно, чтобы двинуться дальше. Руководитель видит это в Пульсе, а не на планёрке через неделю.' },
  { letter: 'B', icon: CalendarClock, title: 'Задержка тянет за собой цепочку', text: 'offix пересчитывает зависимые задачи и предлагает новые сроки. Ничего не меняется без подтверждения руководителя.' },
  { letter: 'C', icon: TrendingDown, title: 'Задачи закрыты, а цифра стоит', text: 'Если KPI не двигается, система говорит об этом прямо: возможно, план не влияет на результат.' },
  { letter: 'D', icon: Gauge, title: 'Нет свежих замеров', text: 'Цель без данных — слепая зона. Напомним владельцу внести факт, прежде чем делать выводы.' },
];

/** Публичная страница: что такое offix и вход в демо. */
export function LandingPage() {
  const demo = kpiProgress({ baseline: 40, target: 30, direction: 'decrease' }, 36.5);
  const empty = kpiProgress({ baseline: 12, target: 10, direction: 'decrease' }, null);
  return (
    <div className="landing">
      <header className="l-nav">
        <Logo size={28} />
        <nav className="row" style={{ gap: 8 }}>
          <a href="#how" className="l-link">Как работает</a>
          <a href="#pilot" className="l-link">Пилот</a>
          <Link to="/login" className="btn btn-primary btn-sm">
            Войти
          </Link>
        </nav>
      </header>

      <section className="l-hero">
        <div className="l-hero-text">
          <div className="eyebrow">Эффективность 360</div>
          <h1>
            Цели, которые
            <br />
            двигают цифры.
          </h1>
          <p className="l-lead">offix связывает цель организации, показатель и каждую задачу на пути к нему — и заранее показывает, где теряется время и какой срок под угрозой.</p>
          <div className="row wrap" style={{ gap: 10 }}>
            <Link to="/login" className="btn btn-primary btn-lg">
              Открыть демо <ArrowRight size={17} />
            </Link>
            <a href="#how" className="btn btn-secondary btn-lg">
              Как это работает
            </a>
          </div>
        </div>
        <div className="l-hero-art" aria-label="Пример карточки цели">
          <div className="card l-card">
            <div className="eyebrow">Учебный офис · стратегическая</div>
            <h3>Сократить время согласования заявки</h3>
            <KpiTrack baseline={40} target={30} current={36.5} unit="minutes" progress={demo} name="Время согласования" size="xl" />
            <div className="l-risk">
              <span className="l-dot" />
              <span>
                <b>Автозаполнение заблокировано 3 дня</b>
                <br />
                <span className="faint">Ждём доступ к API от IT. Срок цели сдвигается на 4 дня.</span>
              </span>
            </div>
          </div>
          <div className="card l-card l-card-small">
            <div className="eyebrow">Без замеров</div>
            <KpiTrack baseline={12} target={10} current={null} unit="days" progress={empty} name="Срок оформления договора" size="md" showLegend={false} />
          </div>
        </div>
      </section>

      <section id="how" className="l-section">
        <h2>Три шага от намерения к результату</h2>
        <div className="l-grid-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="l-step">
              <div className="l-step-num num">0{i + 1}</div>
              <s.icon size={22} aria-hidden />
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="l-section">
        <h2>Риски видны до того, как сорван срок</h2>
        <p className="muted l-sub">Каждый сигнал объясняет, почему он появился и что можно сделать. Решение всегда за человеком.</p>
        <div className="l-grid-2">
          {SCENARIOS.map((s) => (
            <div key={s.letter} className="card l-scenario">
              <span className="l-letter">{s.letter}</span>
              <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
                <h3 className="row" style={{ gap: 8 }}>
                  <s.icon size={18} aria-hidden /> {s.title}
                </h3>
                <p className="muted">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="pilot" className="l-section l-pilot">
        <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <div className="eyebrow">Пилот</div>
          <h2>Университет: заявка студента за 30 минут вместо 40</h2>
          <p className="l-lead" style={{ maxWidth: 560 }}>
            Четыре подразделения — учебный офис, IT, контроль качества и управление персоналом — работают над одной целью. Каждый видит свою часть пути и то, как его задержка влияет на общий результат.
          </p>
        </div>
        <div className="l-stats">
          <div>
            <div className="l-stat num">−25%</div>
            <div className="faint">целевое время согласования</div>
          </div>
          <div>
            <div className="l-stat num">4</div>
            <div className="faint">подразделения в одной карте</div>
          </div>
          <div>
            <div className="l-stat num">1</div>
            <div className="faint">экран, где видно, где теряется время</div>
          </div>
        </div>
      </section>

      <section className="l-section l-grid-3">
        <div className="l-feature">
          <GitBranch size={20} aria-hidden />
          <h3>Структура — когда нужна</h3>
          <p className="muted">Небольшая команда стартует за минуту. Отделы, команды и роли добавляются, когда компания растёт, — без переноса данных.</p>
        </div>
        <div className="l-feature">
          <ShieldCheck size={20} aria-hidden />
          <h3>Доступ по ролям</h3>
          <p className="muted">Сотрудник видит цели своих команд, руководитель — своих подразделений. Личные цели — только владелец и его руководитель.</p>
        </div>
        <div className="l-feature">
          <Lock size={20} aria-hidden />
          <h3>Журнал изменений</h3>
          <p className="muted">Кто, когда и что поменял в цели и KPI — в неизменяемом журнале. Данные компании изолированы друг от друга.</p>
        </div>
      </section>

      <section className="l-cta">
        <h2>Посмотрите на живой пример</h2>
        <p className="muted">Демо-университет с целями, задачами, блокером и задержкой IT. Вход в один клик.</p>
        <Link to="/login" className="btn btn-primary btn-lg">
          Открыть демо <ArrowRight size={17} />
        </Link>
      </section>

      <footer className="l-foot">
        <Logo size={22} />
        <span className="faint">Сделано для FinTech Academy · трек «Эффективность 360»</span>
      </footer>
    </div>
  );
}
