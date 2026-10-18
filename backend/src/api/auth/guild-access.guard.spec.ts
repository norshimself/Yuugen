import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ChannelType, Client } from 'discord.js';
import { GuildAccessGuard } from './guild-access.guard';

describe('GuildAccessGuard', () => {
  const userId = '123456789012345678';
  const guildId = '234567890123456789';

  function setup(manageRequired = false, hasManagePermission = false) {
    const member = {
      permissions: { has: jest.fn().mockReturnValue(hasManagePermission) },
    };
    const guild = {
      members: { fetch: jest.fn().mockResolvedValue(member) },
      channels: {
        fetch: jest.fn().mockResolvedValue({
          type: ChannelType.GuildVoice,
          permissionsFor: () => ({ has: () => true }),
        }),
      },
    };
    const discord = {
      guilds: { cache: new Map([[guildId, guild]]) },
    } as unknown as Client;
    const reflector = {
      getAllAndOverride: jest.fn().mockImplementation((key: string) =>
        key === 'yuugen:requireGuildManager' ? manageRequired : false),
    } as unknown as Reflector;
    const request = {
      user: { id: userId },
      method: 'POST',
      body: { guildId },
      query: {},
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function handle() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext;

    return {
      guard: new GuildAccessGuard(discord, reflector),
      context,
      request,
      guild,
    };
  }

  it('allows valid mutual guild membership', async () => {
    const { guard, context, guild } = setup();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(guild.members.fetch).toHaveBeenCalledWith({
      user: userId,
      force: true,
    });
  });

  it('rejects unauthenticated and demo identities', async () => {
    const { guard, context, request } = setup();
    request.user.id = 'demo_user_55555';
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Sign in with a Discord account',
    );
  });

  it('requires Manage Server for guild settings routes', async () => {
    const { guard, context } = setup(true, false);
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Manage Server permission is required',
    );
  });

  it('does not accept another guild ID hidden in the query string', async () => {
    const { guard, context, request } = setup();
    request.query = { guildId };
    request.body.guildId = '999999999999999999';
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Yuugen is not in this guild',
    );
  });
});
