import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../manual-demo/icons';
import './context-menu.css';

export type ContextMenuItem = {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
};

type Props = {
  x: number;
  y: number;
  label: string;
  items: ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({ x, y, label, items, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const place = () => {
      const bounds = element.getBoundingClientRect();
      const left = Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8));
      const top = Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8));
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [x, y]);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    // Editor blur publishes pending text synchronously. Focus after React's
    // commit so opening a menu cannot trigger a nested editor flush.
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed && element.isConnected) (element.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? element).focus({ preventScroll: true });
    });
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !element.contains(event.target)) close.current();
    };
    const dismissOnBlur = () => close.current();
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('contextmenu', dismissOutside, true);
    window.addEventListener('blur', dismissOnBlur);
    return () => {
      disposed = true;
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('contextmenu', dismissOutside, true);
      window.removeEventListener('blur', dismissOnBlur);
      queueMicrotask(() => {
        const focused = document.activeElement;
        if (opener.current?.isConnected && (focused === document.body || focused === element || element.contains(focused))) {
          opener.current.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }

  // Keep the menu inside the notebook root so it inherits the active theme.
  const portal = document.querySelector('.notebook') ?? document.body;
  return createPortal(<div ref={menu} role="menu" aria-label={label} tabIndex={-1}
    className="nb-context-menu" style={position} onKeyDown={navigate}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    {items.map((item, index) => <div role="none" key={`${item.label}-${index}`}>
      {item.separatorBefore && index > 0 && <div className="nb-context-separator" role="separator" />}
      <button type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
        className={item.danger ? 'is-danger' : undefined}
        onClick={() => { onClose(); item.onSelect(); }}>
        {item.icon && <Icon name={item.icon} />}<span>{item.label}</span>
      </button>
    </div>)}
  </div>, portal);
}
