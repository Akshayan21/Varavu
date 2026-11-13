import { Popover } from 'radix-ui';
import { Check, ChevronsUpDown, Plus, Search, UserRound } from 'lucide-react';
import { useId, useRef, useState } from 'react';

type Customer = { id: string; legal_name: string };
export function CustomerPicker({ customers, value, onSelect, onCreate }: {
  customers: Customer[]; value: string; onSelect: (id: string) => void; onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();
  const selected = customers.find(customer => customer.id === value);
  const matches = customers.filter(customer => customer.legal_name.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="customer-picker">
    <span id={labelId} className="customer-picker-label">Customer</span>
    <Popover.Root open={open} onOpenChange={next => { setOpen(next); if (next) setSearch(''); }}>
      <Popover.Trigger asChild>
        <button ref={trigger} type="button" className="customer-picker-trigger" role="combobox"
          aria-label="Customer" aria-expanded={open} aria-controls={listId} aria-haspopup="listbox">
          <UserRound size={17} aria-hidden="true" />
          <span className={selected ? '' : 'customer-picker-placeholder'}>{selected?.legal_name ?? 'Select customer'}</span>
          <ChevronsUpDown size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="customer-picker-menu" align="start" sideOffset={7} collisionPadding={12}
          onOpenAutoFocus={event => { event.preventDefault(); searchInput.current?.focus(); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input,button'));
              const index = controls.indexOf(document.activeElement as HTMLElement);
              const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
              event.preventDefault();
              controls[next]?.focus();
            }
          }}>
          <div className="customer-picker-search"><Search size={16} aria-hidden="true" />
            <input ref={searchInput} aria-label="Search customers" placeholder="Search customers…" value={search}
              onChange={event => setSearch(event.target.value)} />
          </div>
          <div className="customer-picker-options" id={listId} role="listbox" aria-labelledby={labelId}>
            {matches.map(customer => <button type="button" key={customer.id} role="option"
              aria-selected={value === customer.id} className="customer-picker-option"
              onClick={() => { onSelect(customer.id); setOpen(false); }}>
              <span className="customer-picker-avatar"><UserRound size={15} aria-hidden="true" /></span>
              <span>{customer.legal_name}</span>
              {value === customer.id && <Check size={17} aria-hidden="true" />}
            </button>)}
            {matches.length === 0 && <p className="customer-picker-empty" role="status">No customers found. Create one below.</p>}
          </div>
          <button type="button" className="customer-picker-create" onClick={() => { setOpen(false); onCreate(); }}>
            <Plus size={17} aria-hidden="true" /><span>Create customer</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
