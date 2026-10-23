import { useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode, RefObject } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { Menu } from '@base-ui/react/menu';
import { Select } from '@base-ui/react/select';
import { Dialog } from '@base-ui/react/dialog';
import { Popover } from '@base-ui/react/popover';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { ProfileIcon } from '../../profile/ProfileIcon.tsx';
import { EntityIcon } from '../EntityIcon.tsx';
import type { EntityKind } from '../entityIconGeometry.ts';
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
export function SegmentedChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; icon: ReactNode }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <RadioGroup
      className="sp-segments"
      aria-label={label}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          className="sp-segment"
          aria-label={option.label}
          title={option.label}
        >
          {option.icon}
          <span className="sp-segment-hint" aria-hidden="true">
            {option.label}
          </span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
export type Action = {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
};
export function ActionMenu({
  label,
  children,
  actions,
  primary = false,
  triggerRef,
  finalFocus,
}: {
  label: string;
  children?: ReactNode;
  actions: Action[];
  primary?: boolean;
  triggerRef?: RefObject<HTMLButtonElement>;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        ref={triggerRef}
        aria-label={label}
        className={`sp-control ${primary ? 'sp-primary' : ''}`}
      >
        {children ?? '···'}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="sp-positioner" sideOffset={8} align="end">
          <Menu.Popup className="sp-popup" aria-label={label} finalFocus={finalFocus}>
            {actions.map((action) => (
              <Menu.Item
                key={action.label}
                disabled={action.disabled}
                onClick={action.onClick}
                className={`sp-option ${action.destructive ? 'sp-destructive' : ''} ${action.icon ? 'sp-option-with-icon' : ''}`}
              >
                {action.icon && (
                  <span className="sp-option-icon" aria-hidden="true">
                    {action.icon}
                  </span>
                )}
                {action.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
const modalIcons = {
  folder: 'folder',
  trash: 'trash-2',
  share: 'share-2',
  history: 'history',
  palette: 'palette',
  key: 'key-round',
  person: 'user-round',
  warning: 'triangle-alert',
  upload: 'upload',
  info: 'info',
} as const;

export function Modal({
  title,
  icon = 'info',
  description,
  trigger,
  children,
  open,
  onOpenChange,
  dismissDisabled = false,
  onBack,
}: {
  title: string;
  icon?: keyof typeof modalIcons | EntityKind;
  description?: string;
  trigger?: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  dismissDisabled?: boolean;
  onBack?: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      disablePointerDismissal={dismissDisabled}
      onOpenChange={(next, details) => {
        if (!next && dismissDisabled) {
          details.cancel();
          return;
        }
        onOpenChange?.(next);
      }}
    >
      {trigger && <Dialog.Trigger className="sp-control">{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Backdrop className="sp-backdrop" />
        <Dialog.Popup className="sp-modal sp-ui">
          <div className="sp-modal-heading">
            {onBack && (
              <button
                className="sp-control sp-quiet"
                aria-label="Return to document"
                onClick={onBack}
              >
                <ProfileIcon icon="lucide:arrow-left" />
              </button>
            )}
            <Dialog.Title className="sp-modal-title">
              <span className="sp-modal-title-icon" aria-hidden="true">
                {icon === 'doc' || icon === 'sheet' || icon === 'space' ? (
                  <EntityIcon kind={icon} size={20} />
                ) : (
                  <ProfileIcon icon={`lucide:${modalIcons[icon]}`} size={20} />
                )}
              </span>
              <span>{title}</span>
            </Dialog.Title>
            <Dialog.Close
              className="sp-control"
              aria-label="Close dialog"
              disabled={dismissDisabled}
            >
              ×
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description className="sp-muted">{description}</Dialog.Description>
          )}
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function DetailsPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="sp-control sp-quiet" aria-label={label}>
        {label}
      </Popover.Trigger>
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
