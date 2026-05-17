// URL-safe slug from a name. Lowercase, dashes for spaces, strip everything
// that isn't [a-z0-9-]. Collapse runs of dashes. Trim leading/trailing dashes.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 60;
}
