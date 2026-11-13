import { Select } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { Children, isValidElement, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from 'react';

type Props = SelectHTMLAttributes<HTMLSelectElement>;
export function Dropdown({ children, value, defaultValue, onChange, className, name, disabled, required, ...props }: Props) {
  const [internal, setInternal] = useState<string | undefined>(defaultValue === undefined ? undefined : String(defaultValue));
  const options = Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    const text = Children.toArray(child.props.children).join('');
    return [{ value: String(child.props.value ?? text), label: child.props.children, disabled: child.props.disabled }];
  });
  const current = value === undefined ? (internal ?? options[0]?.value ?? '') : String(value);
  return <><input type="hidden" name={name} value={current} disabled={disabled} /><Select.Root value={current || '__empty__'} disabled={disabled} required={required}
    onValueChange={next => {
      const selected = next === '__empty__' ? '' : next;
      setInternal(selected);
      onChange?.({ target: { value: selected }, currentTarget: { value: selected } } as ChangeEvent<HTMLSelectElement>);
    }}>
    <Select.Trigger className={'ui-select-trigger ' + (className ?? '')}
      aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} id={props.id}>
      <Select.Value /><Select.Icon><ChevronDown size={16} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Content className="ui-select-menu" position="popper" sideOffset={6} collisionPadding={12}>
      <Select.Viewport>{options.map(option => <Select.Item className="ui-select-option" key={option.value}
        value={option.value || '__empty__'} disabled={option.disabled}>
        <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><Check size={16} /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
    </Select.Content></Select.Portal>
  </Select.Root></>;
}
