import { creditsFor, LICENSE_NAMES, licenseText } from '@offix/core';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo } from '../../ui/Logo';
import { SiteFooter } from '../../ui/SiteFooter';
import './credits.css';

/** Полные тексты лицензий: этого требуют MIT, ISC и OFL при распространении кода. */
export function LicensesPage() {
  const credits = creditsFor('web');
  return (
    <>
      <div className="licenses">
        <header className="lic-nav">
          <Link to="/" aria-label="offix — на главную">
            <Logo size={26} />
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm">
            <ArrowLeft size={16} /> На главную
          </Link>
        </header>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <div className="eyebrow">Открытый код</div>
          <h1>Лицензии и благодарности</h1>
          <p className="muted lic-lead">
            offix сделан на открытых библиотеках. Живой градиент, жидкое стекло и 3D-знак — работа их авторов; мы благодарны им и соблюдаем условия лицензий: ниже полный текст каждой.
          </p>
        </div>
        <ul className="lic-list">
          {credits.map((c) => (
            <li key={c.name} className="lic-item">
              <details>
                <summary>
                  <span className="grow">
                    <span className="lic-name">{c.name}</span>
                    <span className="faint lic-role">{c.role}</span>
                  </span>
                  <span className="pill plain">{LICENSE_NAMES[c.license]}</span>
                </summary>
                <div className="lic-body">
                  <a href={c.url} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}>
                    {c.url.replace('https://', '')} <ExternalLink size={14} aria-hidden />
                  </a>
                  <pre>{licenseText(c)}</pre>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
      <SiteFooter />
    </>
  );
}
