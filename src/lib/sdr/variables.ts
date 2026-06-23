/**
 * Prompt variables for the SDR agent (Pedro). The operator writes
 * `{{nome_cliente}}` in the system prompt and the server substitutes the
 * value for the specific lead before sending to the Pedro backend.
 *
 * Two kinds:
 *   - BUILT-IN: code-defined, always available, resolved from the contact /
 *     deal / account / clock (see BUILTIN_VARIABLES + resolveBuiltins in the
 *     processor).
 *   - CUSTOM: operator-defined, stored in `sdr_config.variables`, each mapping
 *     a token name to a `custom_fields` id. Resolved from contact_custom_values.
 *
 * Syntax is `{{double_brace}}` (matches what the ns-crm agent UI used). The
 * substitution is a NO-OP when the prompt has no `{{tokens}}`, so a prompt
 * without variables is byte-identical to before.
 */

/** A custom variable definition as stored in sdr_config.variables. */
export interface CustomVariable {
  /** Token name, without braces. Lowercased, [a-z0-9_]. */
  name: string
  /** custom_fields.id this token pulls its value from. */
  custom_field_id: string
  /** Used when the lead has no value for that field. */
  fallback: string
}

/** Built-in variable descriptors — shown in the UI and resolved server-side. */
export interface BuiltinVariable {
  name: string
  label: string
  example: string
}

export const BUILTIN_VARIABLES: readonly BuiltinVariable[] = [
  { name: 'nome_cliente', label: 'Nome completo do cliente', example: 'Maria Silva' },
  { name: 'empresa', label: 'Empresa do cliente', example: 'Acme Ltda' },
  { name: 'email', label: 'E-mail do cliente', example: 'maria@acme.com' },
  { name: 'telefone', label: 'Telefone do cliente', example: '5531999990000' },
  { name: 'valor_negocio', label: 'Valor do negócio em questão', example: 'R$ 3.500,00' },
  { name: 'nome_agente', label: 'Nome do agente responsável', example: 'Arthur' },
  { name: 'data_atual', label: 'Data atual (dd/mm/aaaa)', example: '22/06/2026' },
] as const

export const BUILTIN_NAMES: readonly string[] = BUILTIN_VARIABLES.map((v) => v.name)

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/** Valid token name: lowercase letters, digits, underscore. */
export function isValidVariableName(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name)
}

/** All distinct token names referenced in a prompt (lowercased). */
export function extractTokens(prompt: string): string[] {
  const out = new Set<string>()
  for (const m of prompt.matchAll(TOKEN_RE)) out.add(m[1].toLowerCase())
  return [...out]
}

/**
 * Replace every `{{token}}` whose name is present in `values` with its value.
 * Unknown tokens are left LITERAL (never blanked) so a typo is visible, never
 * silently dropped — the UI warns about them separately. Pure + synchronous;
 * the caller resolves the value map (DB lookups) beforehand.
 */
export function substituteVariables(prompt: string, values: Record<string, string>): string {
  return prompt.replace(TOKEN_RE, (full, rawName: string) => {
    const name = rawName.toLowerCase()
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : full
  })
}

/**
 * Tokens used in the prompt that resolve to nothing — neither a built-in nor a
 * defined custom variable. Drives the UI warning ("você usou {{x}} mas não
 * criou"). `customNames` are the operator's defined custom variable names.
 */
export function unknownTokens(prompt: string, customNames: string[]): string[] {
  const known = new Set<string>([...BUILTIN_NAMES, ...customNames.map((n) => n.toLowerCase())])
  return extractTokens(prompt).filter((t) => !known.has(t))
}
