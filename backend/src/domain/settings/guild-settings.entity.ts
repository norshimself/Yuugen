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

  @Column({ type: 'varchar', length: 20, nullable: true })
  goodbyeChannelId: string | null;

  @Column({ type: 'varchar', length: 1500, default: 'Goodbye {user} from {guild}.' })
  goodbyeMessage: string;

  @Column({ type: 'boolean', default: false })
  welcomeDmEnabled: boolean;

  @Column({ type: 'varchar', length: 1500, default: 'Welcome to {guild}, {user}!' })
  welcomeDmMessage: string;

  @Column({ type: 'boolean', default: false })
  rulesAcknowledgementEnabled: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rulesChannelId: string | null;

  @Column({ default: false })
  antiSpamEnabled: boolean;

  @Column({ default: false })
  profanityFilterEnabled: boolean;

  @Column('simple-array', { default: '' })
  blacklistedWords: string[];
}
