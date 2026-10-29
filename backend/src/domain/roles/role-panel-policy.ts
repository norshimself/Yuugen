/** Pure validation/planning for self-service guild roles. No Discord side effects. */
export type RolePanelMode = 'buttons' | 'select';
export type RolePanelStatus = 'draft' | 'publishing' | 'active' | 'disabled';

export interface RolePanelOption {
  id: number;
  roleId: string;
  label: string;
  groupKey: string | null;
  prerequisiteRoleId: string | null;
}
export interface RolePanelDefinition {
  id: number;
  guildId: string;
  channelId: string;
  messageId: string | null;
  title: string;
  mode: RolePanelMode;
  status: RolePanelStatus;
  revision: number;
  options: RolePanelOption[];
}
export interface RoleTogglePlan {
  operation: 'add' | 'remove';
  roleId: string;
  removeRoleIds: string[];
}
export const MAX_GUILD_PANELS = 20;
export const MAX_BUTTON_OPTIONS = 10;
export const MAX_SELECT_OPTIONS = 25;
export const ROLE_MEMBER_COOLDOWN_MS = 3000;
export const ROLE_LEASE_MS = 90000;
export const ROLE_COMPONENT_PREFIX = 'yrole';

export const SNOWFLAKE = /^\d{17,20}$/;
const GROUP_KEY = /^[a-z0-9_-]{1,24}$/;
const CUSTOM_ID = /^yrole:(b|s):([1-9]\d{0,9}):([0-9]{1,9})(?::([1-9]\d{0,2}))?$/;

// Dangerous role-wide permission bits must NEVER be self-assignable.
// Additional channel access through permission overwrites is a staff decision.
export const FORBIDDEN_ROLE_PERMISSIONS =
  (1n << 1n) | (1n << 2n) | (1n << 3n) | (1n << 4n) |
  (1n << 5n) | (1n << 7n) | (1n << 13n) | (1n << 17n) |
  (1n << 18n) | (1n << 28n) | (1n << 29n) | (1n << 36n) |
  (1n << 30n) | (1n << 37n) | (1n << 38n) |
  (1n << 40n) | (1n << 43n) | (1n << 44n);

export function validatePanelTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function validateRoleLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function validPanelId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 &&
    (value as number) <= 2147483647;
}
export function normalizeGroupKey(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase().trim();
  return GROUP_KEY.test(normalized) ? normalized : undefined;
}

export function roleConfigurationDenial(value: {
  guildId: string; roleGuildId: string; roleId: string;
  isEveryone: boolean; managed: boolean;
  botHasManageRoles: boolean; botIsAboveRole: boolean;
  permissionBits: bigint;
}): string | null {
  if (!SNOWFLAKE.test(value.roleId) || value.guildId !== value.roleGuildId ||
      value.isEveryone) return 'Choose an ordinary role in this server.';
  if (value.managed) return 'Integration-managed roles cannot be self-assigned.';
  if (!value.botHasManageRoles || !value.botIsAboveRole) {
    return 'The bot needs Manage Roles and a higher role than this option.';
  }
  if ((value.permissionBits & FORBIDDEN_ROLE_PERMISSIONS) !== 0n) {
    return 'Privileged or moderation roles cannot be self-assigned.';
  }
  return null;
}

/**
 * Validate all entries, not only the newest one. Group peers must never
 * require each other; prerequisite cycles are rejected, even across groups.
 */
export function validatePanelOptions(
  mode: RolePanelMode,
  options: readonly RolePanelOption[],
): string | null {
  if (mode !== 'buttons' && mode !== 'select') return 'Unsupported panel mode.';
  const limit = mode === 'buttons' ? MAX_BUTTON_OPTIONS : MAX_SELECT_OPTIONS;
  if (!Array.isArray(options) || options.length > limit) {
    return 'Too many options for this panel layout.';
  }
  const roles = new Set<string>();
  const optionIds = new Set<number>();
  const byRole = new Map<string, RolePanelOption>();
  for (const option of options) {
    if (!validPanelId(option?.id) || option.id > 25 ||
        !SNOWFLAKE.test(option.roleId) || !validateRoleLabel(option.label) ||
        (option.groupKey !== null && normalizeGroupKey(option.groupKey) !== option.groupKey) ||
        (option.prerequisiteRoleId !== null &&
          !SNOWFLAKE.test(option.prerequisiteRoleId))) {
      return 'Invalid role-panel option.';
    }
    if (roles.has(option.roleId) || optionIds.has(option.id)) {
      return 'Duplicate role or option ID in this panel.';
    }
    if (option.prerequisiteRoleId === option.roleId) {
      return 'A role cannot require itself.';
    }
    roles.add(option.roleId);
    optionIds.add(option.id);
    byRole.set(option.roleId, option);
  }
  for (const option of options) {
    let current: RolePanelOption | undefined = option;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.roleId)) return 'Circular role prerequisite.';
      visited.add(current.roleId);
      const parent = current.prerequisiteRoleId
        ? byRole.get(current.prerequisiteRoleId) : undefined;
      if (parent && current.groupKey && current.groupKey === parent.groupKey) {
        return 'An exclusive-group role cannot depend on another group member.';
      }
      current = parent;
    }
  }
  return null;
}

/** A select and button both toggle exactly one option. */
export function planRoleToggle(
  selected: RolePanelOption,
  options: readonly RolePanelOption[],
  memberRoleIds: ReadonlySet<string>,
): { plan: RoleTogglePlan | null; denial: string | null } {
  if (!options.some(option => option.id === selected.id &&
      option.roleId === selected.roleId)) {
    return { plan: null, denial: 'This role is not in the published panel.' };
  }
  const invalid = validatePanelOptions(
    options.length > MAX_BUTTON_OPTIONS ? 'select' : 'buttons', options,
  );
  if (invalid) return { plan: null, denial: invalid };
  if (memberRoleIds.has(selected.roleId)) {
    return {
      plan: { operation: 'remove', roleId: selected.roleId, removeRoleIds: [] },
      denial: null,
    };
  }
  if (selected.prerequisiteRoleId &&
      !memberRoleIds.has(selected.prerequisiteRoleId)) {
    return { plan: null, denial: 'You do not have the prerequisite role.' };
  }
  const removeRoleIds = selected.groupKey
    ? options.filter(option =>
      option.groupKey === selected.groupKey &&
      option.roleId !== selected.roleId &&
      memberRoleIds.has(option.roleId),
    ).map(option => option.roleId)
    : [];
  return {
    plan: { operation: 'add', roleId: selected.roleId, removeRoleIds },
    denial: null,
  };
}

export function buttonCustomId(panelId: number, revision: number, optionId: number): string {
  return 'yrole:b:' + panelId + ':' + revision + ':' + optionId;
}
export function selectCustomId(panelId: number, revision: number): string {
  return 'yrole:s:' + panelId + ':' + revision;
}
export function parseRoleComponent(
  customId: unknown, selectedValue?: unknown,
): { panelId: number; revision: number; optionId: number; mode: RolePanelMode } | null {
  if (typeof customId !== 'string') return null;
  const match = CUSTOM_ID.exec(customId);
  if (!match) return null;
  const mode = match[1] === 'b' ? 'buttons' : 'select';
  const optionId = mode === 'buttons'
    ? Number(match[4]) : Number(selectedValue);
  const panelId = Number(match[2]);
  const revision = Number(match[3]);
  if (!validPanelId(panelId) || revision < 0 || !Number.isSafeInteger(revision) ||
      !validPanelId(optionId) || optionId > 25 ||
      (mode === 'buttons' && !match[4]) ||
      (mode === 'select' && !!match[4]) ||
      (mode === 'select' && (typeof selectedValue !== 'string' ||
        !/^[1-9]\d{0,2}$/.test(selectedValue)))) return null;
  return { panelId, revision, optionId, mode };
}
