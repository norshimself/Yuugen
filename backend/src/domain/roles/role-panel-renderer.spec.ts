import { renderRolePanel } from './role-panel-renderer';
import type { RolePanelDefinition, RolePanelOption } from './role-panel-policy';

describe('Role panel Discord layout (#63)', () => {
  const options: RolePanelOption[] = [
    { id: 1, roleId: '234567890123456789', label: 'Blue',
      groupKey: 'color', prerequisiteRoleId: null },
    { id: 2, roleId: '345678901234567890', label: 'Green',
      groupKey: 'color', prerequisiteRoleId: null },
  ];
  const base: RolePanelDefinition = {
    id: 123, guildId: '123456789012345678',
    channelId: '456789012345678901',
    messageId: null, title: 'Select @everyone **roles**',
    status: 'publishing', revision: 2, mode: 'buttons', options,
  };

  it('renders two inert-by-default mention-safe buttons with signed server-side IDs', () => {
    const data = renderRolePanel(base);
    expect(data.allowedMentions).toEqual({ parse: [] });
    expect(data.components).toHaveLength(1);
    const json = data.components[0].toJSON();
    expect(json.components).toHaveLength(2);
    expect(json.components[0]).toMatchObject({
      custom_id: 'yrole:b:123:2:1', label: 'Blue',
    });
    expect(data.content).toContain('Select @everyone');
  });

  it('supports up to 10 buttons in two rows of five', () => {
    const many = Array.from({ length: 10 }, (_, i): RolePanelOption => ({
      id: i + 1, roleId: String(234567890123456789n + BigInt(i)),
      label: 'Role ' + i, groupKey: null, prerequisiteRoleId: null,
    }));
    const data = renderRolePanel({ ...base, options: many });
    expect(data.components).toHaveLength(2);
    expect(data.components[0].toJSON().components).toHaveLength(5);
    expect(data.components[1].toJSON().components).toHaveLength(5);
  });

  it('renders a restart-stable single-selection dropdown with bounded values', () => {
    const data = renderRolePanel({ ...base, mode: 'select' });
    expect(data.components).toHaveLength(1);
    const menu = data.components[0].toJSON().components[0];
    expect(menu).toMatchObject({
      custom_id: 'yrole:s:123:2',
      min_values: 1, max_values: 1,
      options: [
        expect.objectContaining({ label: 'Blue', value: '1' }),
        expect.objectContaining({ label: 'Green', value: '2' }),
      ],
    });
  });

  it('fails closed for draft panels without options or invalid option identities', () => {
    expect(() => renderRolePanel({ ...base, options: [] }))
      .toThrow('empty options');
    expect(() => renderRolePanel({
      ...base, options: [{ ...options[0], id: 0 }],
    })).toThrow('Invalid role-panel option');
  });
});
