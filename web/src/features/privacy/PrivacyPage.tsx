import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PRIVACY_SECTIONS, PRIVACY_TITLE, privacyDate } from '@offix/core';
import { Logo } from '../../ui/Logo';
import { SiteFooter } from '../../ui/SiteFooter';
import '../credits/credits.css';
import './privacy.css';

/** Политика обработки персональных данных: открыта без входа, на неё ведёт согласие при регистрации. */
export function PrivacyPage() {
  return (
    <>
      <div className="licenses privacy">
        <header className="lic-nav">
          <Link to="/" aria-label="offix — на главную">
            <Logo size={26} />
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm">
            <ArrowLeft size={16} /> На главную
          </Link>
        </header>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <div className="eyebrow row" style={{ gap: 6 }}>
            <ShieldCheck size={14} aria-hidden /> 152-ФЗ
          </div>
          <h1>{PRIVACY_TITLE}</h1>
          <p className="muted lic-lead">Редакция от {privacyDate()}. Коротко и по делу: что offix хранит о вас, зачем, где и как вы можете этим управлять.</p>
        </div>
        <nav className="pv-toc" aria-label="Разделы политики">
          {PRIVACY_SECTIONS.map((s, i) => (
            <a key={s.id} href={`#${s.id}`}>
              <span className="pv-num">{i + 1}</span> {s.title}
            </a>
          ))}
        </nav>
        {PRIVACY_SECTIONS.map((s, i) => (
          <section key={s.id} id={s.id} className="pv-section" aria-labelledby={`pv-${s.id}`}>
            <h2 id={`pv-${s.id}`}>
              <span className="pv-num">{i + 1}</span> {s.title}
            </h2>
            {s.paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {s.list && (
              <ul>
                {s.list.map((li) => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <SiteFooter />
    </>
  );
}
