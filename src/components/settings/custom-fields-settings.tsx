'use client';

import { Shield } from 'lucide-react';

import { TerminalWindow } from '@/components/ui/terminal-window';
import { CustomFieldsPanel } from '@/components/contacts/custom-fields-manager';
import { SettingsChip } from './settings-chip';

/**
 * Settings → Custom Fields card. Manages the account-wide custom
 * contact field catalogue (the same panel the Contacts page exposes
 * via a dialog). Writes are admin-gated by the caller and enforced by
 * `custom_fields` RLS.
 */
export function CustomFieldsSettings() {
  return (
    <TerminalWindow
      title="settings/fields/custom-fields"
      action={
        <SettingsChip variant="admin" className="font-mono text-xs font-medium">
          <Shield />
          Administrador
        </SettingsChip>
      }
    >
      <p className="border-b border-border px-5 py-2 font-mono text-xs text-muted-foreground">
        # campos extras de contato (ex.: CEP, origem do lead). aparecem em todos os contatos e na ação de automação &quot;atualizar campo do contato&quot;.
      </p>
      <div className="p-5">
        <CustomFieldsPanel />
      </div>
    </TerminalWindow>
  );
}
