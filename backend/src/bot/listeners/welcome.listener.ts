import { Injectable } from '@nestjs/common';
import { On } from 'necord';
import { GuildMember, TextChannel, AttachmentBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';

@Injectable()
export class WelcomeListener {
  @On('guildMemberAdd')
  public async onGuildMemberAdd(member: GuildMember) {
    const channel = member.guild.channels.cache.find(
      ch => ch.name === 'welcome' || ch.name === '👋・welcome' || ch.name === 'general'
    ) as TextChannel;

    if (!channel) return;

    try {
      const canvas = createCanvas(700, 250);
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = '#23272a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Welcome text
      ctx.fillStyle = '#ffffff';
      ctx.font = '35px sans-serif';
      ctx.fillText('Welcome to the server!', 250, 100);

      ctx.fillStyle = '#7289da';
      ctx.font = '30px sans-serif';
      ctx.fillText(member.user.username, 250, 150);

      ctx.fillStyle = '#aaaaaa';
      ctx.font = '20px sans-serif';
      ctx.fillText(`Member #${member.guild.memberCount}`, 250, 200);

      // Draw avatar
      const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 128 });
      const avatar = await loadImage(avatarUrl);
      
      // Clip avatar to circle
      ctx.beginPath();
      ctx.arc(125, 125, 60, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.clip();
      
      ctx.drawImage(avatar, 65, 65, 120, 120);

      const buffer = canvas.toBuffer('image/png');
      const attachment = new AttachmentBuilder(buffer, { name: 'welcome-image.png' });

      await channel.send({
        content: `Welcome to the server, ${member}!`,
        files: [attachment],
      });
    } catch (error) {
      console.error('Failed to generate welcome image:', error);
      // Fallback to text message
      await channel.send(`Welcome to the server, ${member}!`);
    }
  }
}
