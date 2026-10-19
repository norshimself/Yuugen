import { Injectable } from '@nestjs/common';
import { On } from 'necord';
import {
  AttachmentBuilder,
  ChannelType,
  GuildMember,
} from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { SettingsService } from '../../domain/settings/settings.service';

export function formatWelcomeMessage(
  template: string,
  userMention: string,
  guildName: string,
): string {
  return template
    .replace(/{user}/gi, userMention)
    .replace(/{guild}/gi, guildName)
    .slice(0, 2000);
}

@Injectable()
export class WelcomeListener {
  constructor(private readonly settingsService: SettingsService) {}

  @On('guildMemberAdd')
  public async onGuildMemberAdd(member: GuildMember): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings(member.guild.id);
      // Empty means disabled: do not choose an arbitrary #general channel.
      if (!settings.welcomeChannelId) return;

      const channel = await member.guild.channels
        .fetch(settings.welcomeChannelId)
        .catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) return;

      const content = formatWelcomeMessage(
        settings.welcomeMessage || 'Welcome {user} to {guild}!',
        `<@${member.id}>`,
        member.guild.name,
      );
      const allowedMentions = { parse: [] as never[], users: [member.id] };

      try {
        const canvas = createCanvas(700, 250);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#23272a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = '35px sans-serif';
        ctx.fillText('Welcome to the server!', 250, 100);
        ctx.fillStyle = '#7289da';
        ctx.font = '30px sans-serif';
        ctx.fillText(member.user.username, 250, 150);
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '20px sans-serif';
        ctx.fillText(`Member #${member.guild.memberCount}`, 250, 200);

        const avatar = await loadImage(
          member.user.displayAvatarURL({ extension: 'png', size: 128 }),
        );
        ctx.beginPath();
        ctx.arc(125, 125, 60, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, 65, 65, 120, 120);

        const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), {
          name: 'welcome-image.png',
        });
        await channel.send({
          content,
          allowedMentions,
          files: [attachment],
        });
      } catch (error) {
        console.warn('Welcome image failed; sending text instead:', error);
        await channel.send({ content, allowedMentions });
      }
    } catch (error) {
      console.warn('Unable to send configured guild welcome:', error);
    }
  }
}
