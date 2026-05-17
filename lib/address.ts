// US states + DC. Used for the address dropdown.
export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

export type StructuredAddress = {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  // Legacy fallback shown only if no structured fields present:
  address?: string | null;
};

// Render an address for display.
export function formatAddress(a: StructuredAddress | null | undefined): string {
  if (!a) return '';
  const { street, city, state, zip, address } = a;
  const hasStructured = !!(street || city || state || zip);
  if (!hasStructured && address) return address;
  const cityStateZip = [city, [state, zip].filter(Boolean).join(' ')]
    .filter((s) => s && s.trim())
    .join(', ');
  return [street, cityStateZip].filter((s) => s && s.trim()).join(', ');
}

// Multi-line variant for layouts that want street on one line, city/state/zip on the next.
export function formatAddressLines(a: StructuredAddress | null | undefined): string[] {
  if (!a) return [];
  const { street, city, state, zip, address } = a;
  const hasStructured = !!(street || city || state || zip);
  if (!hasStructured && address) return address.split(/\r?\n/);
  const lines: string[] = [];
  if (street) lines.push(street);
  const cityLine = [city, [state, zip].filter(Boolean).join(' ')]
    .filter((s) => s && s.trim())
    .join(', ');
  if (cityLine) lines.push(cityLine);
  return lines;
}

// Validate ZIP: 5 digits or 5+4. Returns null if ok, error string otherwise.
export function validateZip(zip: string): string | null {
  if (!zip.trim()) return null; // optional
  if (!/^\d{5}(-\d{4})?$/.test(zip.trim())) {
    return 'ZIP should be 5 digits (or 5+4 like 48009-1234).';
  }
  return null;
}
