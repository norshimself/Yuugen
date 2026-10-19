import { EconomyService } from '../../domain/economy/economy.service';
import { SettingsService } from '../../domain/settings/settings.service';
import { MessageListener } from './message.listener';

describe('MessageListener with configured guild rules', () => {
  const setup = (blacklistedWords: string[] = []) => {
    const economy = {
      addXp: jest.fn().mockResolvedValue({ leveledUp: false, level: 1 }),
    } as unknown as EconomyService;
    const settings = {
      getSettings: jest.fn().mockResolvedValue({
        guildId: '123456789012345678',
        antiSpamEnabled: false,
        profanityFilterEnabled: blacklistedWords.length > 0,
        blacklistedWords,
      }),
    } as unknown as SettingsService;
    const message = {
      guildId: '123456789012345678',
      author: { bot: false, id: '234567890123456789', username: 'tester' },
      content: 'a normal greeting',
      deletable: true,
      delete: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn(),
    };
    return {
      listener: new MessageListener(economy, settings),
      message,
      economy,
    };
  };

  it('deletes configured blocked words and does not award XP', async () => {
    const { listener, message, economy } = setup(['bad word']);
    message.content = 'please stop saying BAD word';
    await listener.onMessage([message] as any);
    expect(message.delete).toHaveBeenCalled();
    expect(economy.addXp).not.toHaveBeenCalled();
  });

  it('awards XP on a normal message', async () => {
    const { listener, message, economy } = setup(['bad word']);
    await listener.onMessage([message] as any);
    expect(message.delete).not.toHaveBeenCalled();
    expect(economy.addXp).toHaveBeenCalledTimes(1);
  });

  it('does not award XP for messages sent by bots', async () => {
    const { listener, message, economy } = setup();
    message.author.bot = true;
    await listener.onMessage([message] as any);
    expect(economy.addXp).not.toHaveBeenCalled();
  });
});
