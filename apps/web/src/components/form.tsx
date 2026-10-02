'use client';

/**
 * Form building blocks for server actions. Every action has the signature (prev, formData) => FormState, so errors
 * come back translated and shown next to the right field without client-side validation code.
 */
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useFormStatus } from 'react-dom';
import { Button, cn, type ButtonProps } from '@rswim/ui';
import { initialFormState, type FormState } from '@/lib/form-state';

export type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const FormCtx = createContext<FormState>(initialFormState);

export const inputClass =
  'min-h-tap w-full rounded-xl border border-line bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-brand-500 aria-[invalid=true]:border-danger';

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  testId,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  testId?: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.ok) ref.current?.reset();
  }, [resetOnSuccess, state.ok, state.savedAt]);
  return (
    <FormCtx.Provider value={state}>
      <form
        ref={ref}
        action={formAction}
        className={cn('flex flex-col gap-3', className)}
        data-testid={testId}
        noValidate
      >
        {state.message ? (
          <p
            role={state.ok ? 'status' : 'alert'}
            className={cn(
              'rounded-xl px-3 py-2 text-sm',
              state.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger',
            )}
          >
            {state.message}
          </p>
        ) : null}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function useFormResult(): FormState {
  return useContext(FormCtx);
}

function Label({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Field({
  name,
  label,
  hint,
  className,
  ...props
}: { name: string; label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const error = useFormResult().errors[name];
  // Unique per instance: the same field name appears in several forms on one page (e.g. one window form per pool).
  const id = useId();
  return (
    <Label label={label} hint={hint} error={error} htmlFor={id}>
      <input
        id={id}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(inputClass, className)}
        {...props}
      />
    </Label>
  );
}

export function TextareaField({
  name,
  label,
  hint,
  ...props
}: { name: string; label: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const error = useFormResult().errors[name];
  const id = useId();
  return (
    <Label label={label} hint={hint} error={error} htmlFor={id}>
      <textarea
        id={id}
        name={name}
        rows={3}
        aria-invalid={Boolean(error)}
        className={cn(inputClass, 'py-2')}
        {...props}
      />
    </Label>
  );
}

export function SelectField({
  name,
  label,
  options,
  hint,
  includeEmpty,
  ...props
}: {
  name: string;
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
  /** Label for an empty first option ("none"). */
  includeEmpty?: string;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const error = useFormResult().errors[name];
  const id = useId();
  return (
    <Label label={label} hint={hint} error={error} htmlFor={id}>
      <select id={id} name={name} aria-invalid={Boolean(error)} className={inputClass} {...props}>
        {includeEmpty !== undefined ? <option value="">{includeEmpty}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Label>
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-tap items-center gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-5 accent-brand-600"
      />
      <span>{label}</span>
    </label>
  );
}

/** Several checkboxes posting `name[]`, e.g. lanes of a window or a staff member's skills. */
export function CheckboxGroup({
  name,
  legend,
  options,
  defaultValues = [],
}: {
  name: string;
  legend: string;
  options: { value: string; label: string }[];
  defaultValues?: readonly string[];
}) {
  const error = useFormResult().errors[name];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 dark:has-[:checked]:bg-surface"
          >
            <input
              type="checkbox"
              name={`${name}[]`}
              value={o.value}
              defaultChecked={defaultValues.includes(o.value)}
              className="size-5 accent-brand-600"
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </fieldset>
  );
}

export function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {children}
    </Button>
  );
}

/** A one-button form (delete, publish…) that still shows the action's error, e.g. "this list is in effect". */
export function ActionButton({
  action,
  children,
  confirm,
  fields = {},
  ...props
}: { action: Action; confirm?: string; fields?: Record<string, string> } & ButtonProps) {
  const [state, formAction] = useActionState(action, initialFormState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex flex-col gap-1"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton {...props}>{children}</SubmitButton>
      {state.message && !state.ok ? (
        <span role="alert" className="text-xs text-danger">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** Shows a value the action returned once (e.g. an invite link), with a copy button. */
export function ResultValue({
  field,
  label,
  copy,
}: {
  field: string;
  label: string;
  copy: string;
}) {
  const value = useFormResult().data?.[field];
  if (!value) return null;
  return (
    <div
      className="flex flex-col gap-1 rounded-xl bg-brand-50 p-3 dark:bg-surface"
      data-testid={`result-${field}`}
    >
      <span className="text-sm font-medium">{label}</span>
      <code dir="ltr" className="break-all text-sm">
        {value}
      </code>
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void navigator.clipboard.writeText(value)}
        >
          {copy}
        </Button>
      </div>
    </div>
  );
}
