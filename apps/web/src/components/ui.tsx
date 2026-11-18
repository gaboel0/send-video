import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCcw, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// ── Botão ────────────────────────────────────────────────────
type Variant = 'ink' | 'card' | 'ghost' | 'danger';
export function Button({
  variant = 'card',
  size,
  busy,
  icon,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm'; busy?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      disabled={rest.disabled || busy}
      className={`btn btn--${variant} ${size ? 'btn--sm' : ''} ${!children ? 'btn--icon' : ''} ${className}`}
    >
      {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
      {children}
    </button>
  );
}

// ── Campo ────────────────────────────────────────────────────
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

// ── Diálogo (elemento <dialog> nativo: foco e Esc acessíveis) ──
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`stock m-auto w-[calc(100%-2rem)] ${width} p-0 text-ink shadow-overlay backdrop:bg-[color-mix(in_oklch,var(--color-board)_35%,transparent)]`}
    >
      {open && (
        <div className="fade-in flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar" icon={<X />} />
          </div>
          <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ── Gaveta lateral ───────────────────────────────────────────
export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[color-mix(in_oklch,var(--color-board)_30%,transparent)] fade-in" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={label} className="slide-in relative flex h-full w-full max-w-xl flex-col bg-paper shadow-overlay">
        {children}
      </aside>
    </div>,
    document.body,
  );
}

// ── Avisos (toasts) ──────────────────────────────────────────
type Toast = { id: number; tone: 'ok' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="stock fade-in pointer-events-auto flex max-w-sm items-start gap-2.5 px-4 py-3 text-sm">
            {t.tone === 'ok' ? (
              <CheckCircle2 className="mt-0.5 size-4 flex-none text-paid" aria-hidden />
            ) : t.tone === 'error' ? (
              <AlertTriangle className="mt-0.5 size-4 flex-none text-danger" aria-hidden />
            ) : (
              <Info className="mt-0.5 size-4 flex-none text-muted" aria-hidden />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Confirmação ──────────────────────────────────────────────
type ConfirmOpts = { title: string; body: ReactNode; confirm: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Dialog
        open={!!state}
        onClose={() => done(false)}
        title={state?.title ?? ''}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => done(false)}>
              Voltar
            </Button>
            <Button variant={state?.danger ? 'danger' : 'ink'} onClick={() => done(true)} autoFocus>
              {state?.confirm}
            </Button>
          </>
        }
      >
        <div className="text-sm text-ink-2">{state?.body}</div>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

// ── Estados de região ────────────────────────────────────────
export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 text-faint [&_svg]:size-8">{icon}</div>}
      <h3 className="text-md">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center" role="alert">
      <AlertTriangle className="mb-3 size-6 text-danger" aria-hidden />
      <h3 className="text-md">Não foi possível carregar</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{(error as Error)?.message ?? 'Erro desconhecido'}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" icon={<RotateCcw />} onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

export const Skeleton = ({ className = '' }: { className?: string }) => <div className={`skeleton ${className}`} aria-hidden />;

export function Avatar({ src, name, size = 28 }: { src?: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .replace(/^@/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return src && !broken ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      referrerPolicy="no-referrer"
      className="flex-none rounded-full bg-paper-3 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="inline-flex flex-none items-center justify-center rounded-full bg-paper-3 font-medium text-muted"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials || '?'}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
