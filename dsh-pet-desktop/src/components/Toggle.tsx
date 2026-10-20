// 统一切换开关：原生 button + role="switch"，保留键盘与读屏语义。

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="dsh-vpet-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="dsh-vpet-switch-knob" aria-hidden="true" />
    </button>
  );
}
