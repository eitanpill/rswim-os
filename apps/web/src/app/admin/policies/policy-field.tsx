import type { PolicyField } from '@rswim/contracts';
import { CheckboxField, CheckboxGroup, Field, SelectField } from '@/components/form';

/**
 * One rule in the policy editor. Every input may be left blank ("not set in this version"); at org level the blank
 * means the rule is simply absent and code falls back to the documented default.
 */
export function PolicyFieldInput({
  field: f,
  label,
  value,
  isOrg,
  inherited,
  options,
  labels,
}: {
  field: PolicyField;
  label: string;
  value: unknown;
  isOrg: boolean;
  inherited?: string;
  options: { value: string; label: string }[];
  labels: { inherit: string; yes: string; no: string; override: string; unit: string };
}) {
  const name = `r:${f.path}`;
  const blank = isOrg ? '—' : labels.inherit;
  if (f.type === 'int') {
    // Money and percentages are stored as agorot and basis points but typed as shekels and percent.
    const scaled = f.unit === 'agorot' || f.unit === 'bp';
    return (
      <Field
        name={name}
        label={labels.unit ? `${label} (${labels.unit})` : label}
        type="number"
        inputMode={scaled ? 'decimal' : 'numeric'}
        step={scaled ? '0.01' : '1'}
        min={scaled ? f.min / 100 : f.min}
        max={scaled ? f.max / 100 : f.max}
        defaultValue={typeof value === 'number' ? String(scaled ? value / 100 : value) : ''}
        placeholder={isOrg ? undefined : labels.inherit}
        hint={inherited}
      />
    );
  }
  if (f.type === 'boolean') {
    return (
      <SelectField
        name={name}
        label={label}
        includeEmpty={blank}
        options={[
          { value: 'true', label: labels.yes },
          { value: 'false', label: labels.no },
        ]}
        defaultValue={typeof value === 'boolean' ? String(value) : ''}
        hint={inherited}
      />
    );
  }
  if (f.type === 'enum') {
    return (
      <SelectField
        name={name}
        label={label}
        includeEmpty={blank}
        options={options}
        defaultValue={typeof value === 'string' ? value : ''}
        hint={inherited}
      />
    );
  }
  const list = Array.isArray(value) ? (value as string[]) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <CheckboxGroup name={name} legend={label} options={options} defaultValues={list ?? []} />
      {isOrg ? null : (
        <CheckboxField
          name={`set:${f.path}`}
          label={labels.override}
          defaultChecked={list !== undefined}
        />
      )}
      {inherited ? <p className="text-xs text-ink-muted">{inherited}</p> : null}
    </div>
  );
}
