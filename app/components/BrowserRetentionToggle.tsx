export function BrowserRetentionToggle({
  checked,
  onChange,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`browser-retention-toggle ${className}`.trim()}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>Remember this derived graph on this device for 7 days.</strong>
        <small>Source files are never stored.</small>
      </span>
    </label>
  );
}
