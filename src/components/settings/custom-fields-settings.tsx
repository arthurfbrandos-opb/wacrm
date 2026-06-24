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
          Admin
        </SettingsChip>
      }
    >
      <p className="border-b border-border px-5 py-2 font-mono text-xs text-muted-foreground">
        # extra contact fields (e.g. zip code, lead source). they appear on every contact and in the &quot;update contact field&quot; automation action.
      </p>
      <div className="p-5">
        <CustomFieldsPanel />
      </div>
    </TerminalWindow>
  );
}
