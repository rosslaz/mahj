'use client';

import { US_STATES } from '@/lib/address';

export type AddressFieldsValue = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

// "Mode" governs how the address requirements are presented:
//   - 'optional':       everything optional (private events, club home, etc.)
//   - 'public_event':   city + state required (will be shown to non-members
//                       for discovery); street optional but encouraged
//                       (visible only to approved attendees)
//   - 'public_club':    city + state + zip required (used for distance-based
//                       discovery). Street not collected for clubs.
//   - 'all_required':   every field required
export function AddressFields({
  value,
  onChange,
  mode = 'optional',
  helperText,
}: {
  value: AddressFieldsValue;
  onChange: (next: AddressFieldsValue) => void;
  mode?: 'optional' | 'public_event' | 'public_club' | 'all_required';
  helperText?: string;
}) {
  function set<K extends keyof AddressFieldsValue>(key: K, v: AddressFieldsValue[K]) {
    onChange({ ...value, [key]: v });
  }
  const cityStateRequired = mode !== 'optional';
  const zipRequired = mode === 'public_club' || mode === 'all_required';
  const streetRequired = mode === 'all_required';
  const showStreet = mode !== 'public_club';

  return (
    <fieldset className="space-y-4">
      <legend className="label">
        Address
        {mode === 'optional' && (
          <span className="text-ink/30 normal-case tracking-normal italic font-normal"> — optional</span>
        )}
      </legend>

      {showStreet && (
        <div>
          <input
            className="input"
            value={value.street}
            onChange={(e) => set('street', e.target.value)}
            placeholder={streetRequired ? 'Street address' : 'Street address (optional)'}
            autoComplete="street-address"
            required={streetRequired}
          />
          {mode === 'public_event' && (
            <p className="text-xs text-ink/40 italic mt-1">
              Street is shown only to attendees once their signup is approved.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 sm:col-span-6">
          <input
            className="input"
            value={value.city}
            onChange={(e) => set('city', e.target.value)}
            placeholder={cityStateRequired ? 'City *' : 'City'}
            autoComplete="address-level2"
            required={cityStateRequired}
          />
        </div>
        <div className="col-span-5 sm:col-span-3">
          <select
            className="input"
            value={value.state}
            onChange={(e) => set('state', e.target.value)}
            autoComplete="address-level1"
            required={cityStateRequired}
          >
            <option value="">{cityStateRequired ? 'State *' : 'State'}</option>
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
            placeholder={zipRequired ? 'ZIP *' : 'ZIP'}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
            required={zipRequired}
          />
        </div>
      </div>

      {mode === 'public_event' && (
        <p className="text-xs text-cinnabar/80 italic">
          City and state are visible publicly so people can discover this event nearby.
        </p>
      )}
      {mode === 'public_club' && (
        <p className="text-xs text-cinnabar/80 italic">
          City, state, and ZIP are used to show your club to nearby players looking to discover clubs.
        </p>
      )}
      {helperText && <p className="text-xs text-ink/40 italic">{helperText}</p>}
    </fieldset>
  );
}
