import { ArrowRight, Ban, CalendarClock, Gauge, GitBranch, Lock, Route, ShieldCheck, Target, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { kpiProgress } from '@offix/core';
import { KpiTrack } from '../../ui/KpiTrack';
import { Logo } from '../../ui/Logo';
import { SiteFooter } from '../../ui/SiteFooter';
import { Backdrop } from '../../ui/fx/Backdrop';
import { Glass } from '../../ui/fx/Glass';
import { PilotChart } from '../../ui/fx/PilotChart';
import './landing.css';

/** Пилот: было 40 минут, сейчас 36,5, цель 30. Те же числа, что в демо-данных. */
export const PILOT_BARS = [
  { value: 40, label: 'было' },
  { value: 36.5, label: 'сейчас' },
  { value: 30, label: 'цель', target: true },
];

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
  return (
    <>
      <div className="l-top">
        <Backdrop variant="hero" mark className="l-stage on-color">
          <header className="l-nav">
            <Glass className="l-nav-glass" radius={999} elasticity={0.08} displacement={48}>
              <div className="l-nav-row">
                <Link to="/" aria-label="offix — на главную">
                  <Logo size={26} />
                </Link>
                <nav className="row" style={{ gap: 2 }} aria-label="Разделы">
                  <a href="#how" className="l-link">Как работает</a>
                  <a href="#pilot" className="l-link">Пилот</a>
                  <Link to="/login" className="btn btn-primary btn-sm l-nav-cta">
                    Войти
                  </Link>
                </nav>
              </div>
            </Glass>
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
              <Glass className="l-card-glass" radius={28}>
                <div className="l-card">
                  <div className="eyebrow">Учебный офис · стратегическая</div>
                  <h3>Сократить время согласования заявки</h3>
                  <KpiTrack baseline={40} target={30} current={36.5} unit="minutes" progress={demo} name="Время согласования" size="lg" />
                  <div className="l-risk">
                    <span className="l-dot" />
                    <span>
                      <b>Автозаполнение заблокировано 3 дня</b>
                      <br />
                      <span className="faint">Ждём доступ к API от IT. Срок цели сдвигается на 4 дня.</span>
                    </span>
                  </div>
                </div>
              </Glass>
            </div>
          </section>
        </Backdrop>
      </div>

      <div className="landing">
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
        <div className="stack" style={{ '--gap': '20px' } as React.CSSProperties}>
          <PilotChart bars={PILOT_BARS} unit="мин" caption="Время согласования заявки студента" />
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

      <Backdrop variant="login" className="l-cta on-color">
        <h2>Посмотрите на живой пример</h2>
        <p className="muted">Демо-университет с целями, задачами, блокером и задержкой IT. Вход в один клик.</p>
        <Link to="/login" className="btn btn-primary btn-lg">
          Открыть демо <ArrowRight size={17} />
        </Link>
      </Backdrop>
      </div>
      <SiteFooter />
    </>
  );
}
