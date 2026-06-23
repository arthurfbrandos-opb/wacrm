/** Tag helpers shared by the inbox quick-create + assign flow. */

export interface TagLike {
  id: string
  name: string
  color: string
}

/** Trimmed, case-insensitive comparison key for a tag name. */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Find an existing tag whose name matches (trimmed, case-insensitive), so a
 * quick-create reuses it instead of inserting a duplicate. Returns undefined
 * when none matches or the name is blank.
 */
export function findTagByName<T extends TagLike>(
  tags: T[],
  name: string,
): T | undefined {
  const key = normalizeTagName(name)
  if (!key) return undefined
  return tags.find((t) => normalizeTagName(t.name) === key)
}
