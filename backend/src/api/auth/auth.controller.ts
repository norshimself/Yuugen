import { Controller, Get, UseGuards, Req, Res } from '@nestjs/common';
import { DiscordAuthGuard } from './discord-auth.guard';

@Controller('auth')
export class AuthController {
  @Get('login')
  @UseGuards(DiscordAuthGuard)
  async login() {
    // The guard redirects to Discord.
  }

  @Get('callback')
  @UseGuards(DiscordAuthGuard)
  async callback(@Req() req: any, @Res() res: any) {
    // req.user contains the profile returned by validate() in DiscordStrategy.
    res.json({
      success: true,
      message: 'Authentication successful',
      user: req.user
    });
  }
}
