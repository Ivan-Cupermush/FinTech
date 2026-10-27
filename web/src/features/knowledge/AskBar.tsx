import { ArrowUp, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Glass } from '../../ui/fx/Glass';

/**
 * Строка «Спросить» на шапке базы знаний: жидкое стекло поверх градиента.
 * Вопрос открывает помощника и сразу задаётся.
 */
export function AskBar() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    navigate(t ? `/app/notes/ask?q=${encodeURIComponent(t)}` : '/app/notes/ask');
  };
  return (
    <Glass className="kb-askbar" radius={24} clip elasticity={0.04} displacement={36}>
      <form className="kb-askbar-form" role="search" aria-label="Спросить базу знаний" onSubmit={submit}>
        <Sparkles size={18} aria-hidden className="kb-askbar-spark" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Спросите базу знаний: кто согласует командировку?" aria-label="Вопрос помощнику" maxLength={2000} />
        <button type="submit" className="kb-send" aria-label="Спросить помощника">
          <ArrowUp size={18} />
        </button>
      </form>
    </Glass>
  );
}
