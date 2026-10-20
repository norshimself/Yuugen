import { User } from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationCommands } from './moderation.command';

describe('Moderation Discord commands', () => {
  const guildId = '123456789012345678';
  const staffId = '234567890123456789';
  const targetId = '345678901234567890';
  const ownerId = '456789012345678901';

  function setup(options: { staffAllowed?: boolean; roleComparison?: number } = {}) {
    const staff = {
      permissions: {
        has: jest.fn().mockReturnValue(options.staffAllowed !== false),
      },
      roles: {
        highest: {
          comparePositionTo: jest.fn().mockReturnValue(options.roleComparison ?? 1),
        },
      },
    };
    const targetMember = { roles: { highest: {} } };
    const guild = {
      id: guildId,
      ownerId,
      members: {
        fetch: jest.fn(async ({ user }: { user: string }) =>
          user === staffId ? staff : user === targetId ? targetMember : null),
      },
    };
    const interaction = {
      guild,
      guildId,
      user: { id: staffId },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
    const user = { id: targetId, bot: false } as User;
    const moderation = {
      warn: jest.fn().mockResolvedValue({ id: 42 }),
      warnings: jest.fn().mockResolvedValue([]),
      unwarn: jest.fn().mockResolvedValue({ id: 42 }),
    } as unknown as ModerationService;
    return {
      commands: new ModerationCommands(moderation),
      interaction,
      moderation,
      user,
    };
  }

  it('denies users without Moderate Members permission', async () => {
    const { commands, interaction, moderation, user } = setup({
      staffAllowed: false,
    });
    await commands.onWarn([interaction] as any, { user, reason: 'rule' });
    expect(moderation.warn).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Moderate Members'));
  });

  it('blocks warnings against equal/higher roles', async () => {
    const { commands, interaction, moderation, user } = setup({
      roleComparison: 0,
    });
    await commands.onWarn([interaction] as any, { user, reason: 'rule' });
    expect(moderation.warn).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('above'));
  });

  it('creates cases only for the invoking guild and actor', async () => {
    const { commands, interaction, moderation, user } = setup();
    await commands.onWarn([interaction] as any, { user, reason: 'rule' });
    expect(moderation.warn).toHaveBeenCalledWith(
      guildId, targetId, staffId, 'rule',
    );
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      allowedMentions: { parse: [] },
    }));
  });

  it('requires staff permission to view warning history', async () => {
    const { commands, interaction, moderation, user } = setup({
      staffAllowed: false,
    });
    await commands.onWarnings([interaction] as any, { user });
    expect(moderation.warnings).not.toHaveBeenCalled();
  });

  it('passes the guild ID when removing a warning', async () => {
    const { commands, interaction, moderation } = setup();
    await commands.onUnwarn([interaction] as any, {
      id: 42,
      reason: 'issued in error',
    });
    expect(moderation.unwarn).toHaveBeenCalledWith(
      guildId, 42, staffId, 'issued in error',
    );
  });
});
