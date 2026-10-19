import { AlertCircle } from 'lucide-react';
import { useId, type ReactNode } from 'react';

/** Поле с подписью, подсказкой и ошибкой. Ошибку показываем только после взаимодействия. */
export function Field({
  label,
  required,
  hint,
  error,
  counter,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  counter?: { value: number; max: number };
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = `${id}-desc`;
  return (
    <div className="field">
      <div className="spread">
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span className="req" aria-hidden>·&nbsp;обязательно</span>}
        </label>
        {counter && counter.value > counter.max * 0.8 && (
          <span className={`counter ${counter.value > counter.max ? 'over' : ''}`}>
            {counter.value}/{counter.max}
          </span>
        )}
      </div>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      <div id={describedBy}>
        {error ? (
          <div className="field-error" role="alert">
            <AlertCircle size={14} style={{ marginTop: 2, flex: 'none' }} aria-hidden />
            <span>{error}</span>
          </div>
        ) : hint ? (
          <div className="field-hint">{hint}</div>
        ) : null}
      </div>
    </div>
  );
}
