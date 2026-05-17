'use client';

import { US_STATES } from '@/lib/address';

export type AddressFieldsValue = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export function AddressFields({
  value,
  onChange,
  optional = true,
  helperText,
}: {
  value: AddressFieldsValue;
  onChange: (next: AddressFieldsValue) => void;
  optional?: boolean;
  helperText?: string;
}) {
  function set<K extends keyof AddressFieldsValue>(key: K, v: AddressFieldsValue[K]) {
    onChange({ ...value, [key]: v });
  }
  return (
    <fieldset className="space-y-4">
      <legend className="label">
        Address
        {optional && (
          <span className="text-ink/30 normal-case tracking-normal italic font-normal"> — optional</span>
        )}
      </legend>

      <div>
        <input
          className="input"
          value={value.street}
          onChange={(e) => set('street', e.target.value)}
          placeholder="Street address"
          autoComplete="street-address"
        />
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 sm:col-span-6">
          <input
            className="input"
            value={value.city}
            onChange={(e) => set('city', e.target.value)}
            placeholder="City"
            autoComplete="address-level2"
          />
        </div>
        <div className="col-span-5 sm:col-span-3">
          <select
            className="input"
            value={value.state}
            onChange={(e) => set('state', e.target.value)}
            autoComplete="address-level1"
          >
            <option value="">State</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code}</option>
            ))}
          </select>
        </div>
        <div className="col-span-7 sm:col-span-3">
          <input
            className="input"
            value={value.zip}
            onChange={(e) => set('zip', e.target.value)}
            placeholder="ZIP"
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
          />
        </div>
      </div>

      {helperText && <p className="text-xs text-ink/40 italic">{helperText}</p>}
    </fieldset>
  );
}
