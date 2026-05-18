import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-discord';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DiscordStrategy extends PassportStrategy(Strategy, 'discord') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get<string>('DISCORD_CLIENT_ID') || '',
      clientSecret: configService.get<string>('DISCORD_CLIENT_SECRET') || '',
      callbackURL: configService.get<string>('DISCORD_REDIRECT_URI') || '',
      scope: ['identify', 'guilds'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any) {
    // For now, just return the profile.
    // In a full implementation, you would save/update the user in Postgres.
    return profile;
  }
}
