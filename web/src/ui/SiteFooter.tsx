import { creditsFor, LICENSE_NAMES } from '@offix/core';
import { Link } from 'react-router-dom';
import { Logo } from './Logo';
import './site-foot.css';

/**
 * Подвал публичных страниц: кто мы и на чьём открытом коде сделан дизайн.
 * Лицензии MIT просят сохранять копирайт — полный текст на странице «Лицензии».
 */
export function SiteFooter() {
  const featured = creditsFor('web').filter((c) => c.featured);
  return (
    <footer className="site-foot">
      <div className="site-foot-main">
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <Logo size={22} />
          <span className="faint">Сделано для FinTech Academy · трек «Эффективность 360»</span>
        </div>
        <div className="site-foot-credits">
          <div className="eyebrow">Спасибо открытому коду</div>
          <ul>
            {featured.map((c) => (
              <li key={c.name}>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
                <span className="faint"> · {LICENSE_NAMES[c.license].replace(' License', '')}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="site-foot-bottom faint">
        <span>© {new Date().getFullYear()} offix</span>
        <Link to="/licenses">Лицензии и благодарности</Link>
      </div>
    </footer>
  );
}
