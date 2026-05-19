import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('guild_settings')
export class GuildSettings {
  @PrimaryColumn()
  guildId: string;

  @Column({ default: 'y!' })
  prefix: string;

  @Column({ nullable: true })
  welcomeChannelId: string;

  @Column({ default: 'Welcome {user} to the server!' })
  welcomeMessage: string;

  @Column({ default: false })
  antiSpamEnabled: boolean;

  @Column({ default: false })
  profanityFilterEnabled: boolean;

  @Column('simple-array', { default: '' })
  blacklistedWords: string[];
}
