import { unitLabel, unitOptions } from "../lib/units";

/**
 * Standard unit picker shared by the Guide ingredient rows and the
 * Inventory add/edit dialogs, so every unit is one of the known choices
 * (g, ml, L, pack, …). The blank "No unit" option keeps unit optional;
 * a stored non-standard unit stays selectable for legacy rows.
 */
export function UnitSelect({
  value,
  onChange,
  name,
  ariaLabel,
  className = "",
}: {
  value: string;
  onChange: (unit: string) => void;
  name?: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      name={name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={`border border-ink/20 bg-paper px-2 py-1 text-base text-ink ${className}`.trim()}
    >
      <option value="">No unit</option>
      {unitOptions(value).map((unit) => (
        <option key={unit} value={unit}>
          {unitLabel(unit)}
        </option>
      ))}
    </select>
  );
}
