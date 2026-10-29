import {
  FORBIDDEN_ROLE_PERMISSIONS, MAX_BUTTON_OPTIONS, MAX_SELECT_OPTIONS,
  normalizeGroupKey, parseRoleComponent, planRoleToggle,
  roleConfigurationDenial, validatePanelOptions, validatePanelTitle,
  validateRoleLabel, buttonCustomId, selectCustomId,
  type RolePanelOption,
} from './role-panel-policy';

describe('Self-role panel policy (#63)', () => {
  const guildId = '123456789012345678';
  const first = '234567890123456789';
  const second = '345678901234567890';
  const third = '456789012345678901';
  const choices: RolePanelOption[] = [
    { id: 1, roleId: first, label: 'Blue', groupKey: 'color', prerequisiteRoleId: null },
    { id: 2, roleId: second, label: 'Green', groupKey: 'color', prerequisiteRoleId: null },
    { id: 3, roleId: third, label: 'News', groupKey: null, prerequisiteRoleId: first },
  ];

  it('sanitizes titles, option labels, and exclusive group keys', () => {
    expect(validatePanelTitle('Choose roles')).toBe(true);
    expect(validatePanelTitle('')).toBe(false);
    expect(validatePanelTitle('a'.repeat(101))).toBe(false);
    expect(validatePanelTitle('bad\nheader')).toBe(false);
    expect(validateRoleLabel('Announcements')).toBe(true);
    expect(validateRoleLabel('x'.repeat(81))).toBe(false);
    expect(validateRoleLabel('@everyone')).toBe(true);
    expect(normalizeGroupKey(' COLOR ')).toBe('color');
    expect(normalizeGroupKey('')).toBeNull();
    expect(normalizeGroupKey('  Invalid key')).toBeUndefined();
  });

  it('permits independently assignable options and exclusivity', () => {
    expect(validatePanelOptions('buttons', choices)).toBeNull();
    expect(validatePanelOptions('select', choices)).toBeNull();
    expect(validatePanelOptions('bad' as any, choices)).toContain('Unsupported');
    expect(MAX_BUTTON_OPTIONS).toBe(10);
    expect(MAX_SELECT_OPTIONS).toBe(25);
  });

  it('rejects duplicated roles, IDs and invalid nested role data', () => {
    expect(validatePanelOptions('buttons', [choices[0], choices[0]]))
      .toContain('Duplicate');
    expect(validatePanelOptions('buttons', [choices[0], {
      ...choices[1], id: 1,
    }])).toContain('Duplicate');
    expect(validatePanelOptions('buttons', [{ ...choices[0],
      roleId: 'not-snowflake',
    }])).toContain('Invalid');
    expect(validatePanelOptions('buttons', [{ ...choices[0],
      prerequisiteRoleId: first,
    }])).toContain('require itself');
    expect(validatePanelOptions('buttons', [{ ...choices[0],
      groupKey: '../path',
    }])).toContain('Invalid');
  });

  it('bounds button and select option counts to Discord component limits', () => {
    const all = Array.from({ length: 25 }, (_, index): RolePanelOption => ({
      id: index + 1,
      roleId: String(BigInt(first) + BigInt(index)),
      label: 'Option ' + (index + 1), groupKey: null,
      prerequisiteRoleId: null,
    }));
    expect(validatePanelOptions('select', all)).toBeNull();
    expect(validatePanelOptions('buttons', all)).toContain('Too many');
    expect(validatePanelOptions('buttons', all.slice(0, 10))).toBeNull();
    expect(validatePanelOptions('select', [...all, {
      ...all[24], id: 26, roleId: '987654321098765432',
    }])).toContain('Too many');
  });

  it('rejects prerequisite cycles and impossible same-group requirements', () => {
    const cyclic: RolePanelOption[] = [
      { ...choices[0], groupKey: null, prerequisiteRoleId: second },
      { ...choices[1], groupKey: null, prerequisiteRoleId: first },
    ];
    expect(validatePanelOptions('buttons', cyclic)).toContain('Circular');
    expect(validatePanelOptions('buttons', [
      { ...choices[0], prerequisiteRoleId: second },
      choices[1],
    ])).toContain('exclusive-group');
    expect(validatePanelOptions('buttons', [
      { ...choices[0], prerequisiteRoleId: third },
      { ...choices[1], groupKey: null },
      { ...choices[2], groupKey: 'color', prerequisiteRoleId: null },
    ])).toContain('exclusive-group');
  });

  it('adds a selected role and removes only conflicting group peers', () => {
    expect(planRoleToggle(choices[1], choices, new Set([first, third])))
      .toEqual({
        plan: { operation: 'add', roleId: second, removeRoleIds: [first] },
        denial: null,
      });
    expect(planRoleToggle(choices[1], choices, new Set([third])))
      .toEqual({
        plan: { operation: 'add', roleId: second, removeRoleIds: [] },
        denial: null,
      });
    expect(planRoleToggle(choices[2], choices, new Set())).toEqual({
      plan: null, denial: 'You do not have the prerequisite role.',
    });
  });

  it('toggles off an existing role without deleting unrelated roles', () => {
    expect(planRoleToggle(choices[1], choices, new Set([second, third])))
      .toEqual({
        plan: { operation: 'remove', roleId: second, removeRoleIds: [] },
        denial: null,
      });
    expect(planRoleToggle({ ...choices[0], roleId: third }, choices,
      new Set([third])).denial).toContain('not in');
  });

  it('rejects dangerous, managed, cross-guild, everyone and elevated roles', () => {
    const safe = {
      guildId, roleGuildId: guildId, roleId: first,
      isEveryone: false, managed: false, botHasManageRoles: true,
      botIsAboveRole: true, permissionBits: 0n,
    };
    expect(roleConfigurationDenial(safe)).toBeNull();
    expect(roleConfigurationDenial({ ...safe, isEveryone: true }))
      .toContain('ordinary');
    expect(roleConfigurationDenial({ ...safe, managed: true }))
      .toContain('Integration-managed');
    expect(roleConfigurationDenial({ ...safe, roleGuildId: second }))
      .toContain('ordinary');
    expect(roleConfigurationDenial({ ...safe, botHasManageRoles: false }))
      .toContain('Manage Roles');
    expect(roleConfigurationDenial({ ...safe, botIsAboveRole: false }))
      .toContain('higher role');
    expect(roleConfigurationDenial({ ...safe, permissionBits: 1n << 3n }))
      .toContain('Privileged');
    expect(roleConfigurationDenial({ ...safe, permissionBits: 1n << 28n }))
      .toContain('Privileged');
    expect((FORBIDDEN_ROLE_PERMISSIONS & (1n << 40n)) !== 0n).toBe(true);
  });

  it('uses bounded custom IDs and rejects copied or malformed control values', () => {
    expect(parseRoleComponent(buttonCustomId(123, 4, 2)))
      .toEqual({ panelId: 123, revision: 4, optionId: 2, mode: 'buttons' });
    expect(parseRoleComponent(selectCustomId(123, 4), '2'))
      .toEqual({ panelId: 123, revision: 4, optionId: 2, mode: 'select' });
    expect(parseRoleComponent(selectCustomId(123, 4), '0')).toBeNull();
    expect(parseRoleComponent(selectCustomId(123, 4), '1,2')).toBeNull();
    expect(parseRoleComponent(buttonCustomId(123, 4, 2), '3')?.optionId).toBe(2);
    expect(parseRoleComponent('yrole:b:123:4:0')).toBeNull();
    expect(parseRoleComponent('yrole:s:123:4:2', '2')).toBeNull();
    expect(parseRoleComponent('yrole:b:abc:4:2')).toBeNull();
    expect(parseRoleComponent('yrole:b:123:4:2:extra')).toBeNull();
    expect(parseRoleComponent('other:menu:123:4:2')).toBeNull();
  });
});
