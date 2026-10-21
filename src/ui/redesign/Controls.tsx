import { useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { Menu } from '@base-ui/react/menu';
import { Select } from '@base-ui/react/select';
import { Dialog } from '@base-ui/react/dialog';
import { Popover } from '@base-ui/react/popover';
import './controls.css';

export function Button({
  primary,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <BaseButton {...props} className={`sp-control ${primary ? 'sp-primary' : ''} ${className}`} />
  );
}

export function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="sp-choice">
      <label id={id}>{label}</label>
      <Select.Root
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
        items={options}
        disabled={disabled}
      >
        <Select.Trigger className="sp-control" aria-labelledby={id}>
          <Select.Value />
          <Select.Icon>⌄</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="sp-positioner" sideOffset={4} alignItemWithTrigger={false}>
            <Select.Popup className="sp-popup">
              <Select.List>
                {options.map((option) => (
                  <Select.Item key={option.value} value={option.value} className="sp-option">
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator>✓</Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
export type Action = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
};
export function ActionMenu({
  label,
  children,
  actions,
  primary = false,
}: {
  label: string;
  children?: ReactNode;
  actions: Action[];
  primary?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className={`sp-control ${primary ? 'sp-primary' : ''}`}>
        {children ?? '···'}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="sp-positioner" sideOffset={8} align="end">
          <Menu.Popup className="sp-popup" aria-label={label}>
            {actions.map((action) => (
              <Menu.Item
                key={action.label}
                disabled={action.disabled}
                onClick={action.onClick}
                className={`sp-option ${action.destructive ? 'sp-destructive' : ''}`}
              >
                {action.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function Modal({
  title,
  description,
  trigger,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  description: string;
  trigger?: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger className="sp-control">{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Backdrop className="sp-backdrop" />
        <Dialog.Popup className="sp-modal sp-ui">
          <div className="sp-modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="sp-control" aria-label="Close dialog">
              ×
            </Dialog.Close>
          </div>
          <Dialog.Description className="sp-muted">{description}</Dialog.Description>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function DetailsPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="sp-control sp-quiet">{label}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="sp-positioner" sideOffset={8}>
          <Popover.Popup className="sp-popup sp-ui">
            <Popover.Title>{label}</Popover.Title>
            {children}
            <Popover.Close className="sp-control">Close</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
