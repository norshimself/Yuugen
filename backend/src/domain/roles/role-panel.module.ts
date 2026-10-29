import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolePanel } from './role-panel.entity';
import { RolePanelMemberLock } from './role-panel-member-lock.entity';
import { RolePanelAction } from './role-panel-action.entity';
import { RolePanelService } from './role-panel.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    RolePanel, RolePanelMemberLock, RolePanelAction,
  ])],
  providers: [RolePanelService],
  exports: [RolePanelService],
})
export class RolePanelModule {}
