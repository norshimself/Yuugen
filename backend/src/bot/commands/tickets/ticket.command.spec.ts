import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { TicketCommands } from './ticket.command';
import { TicketChannelEvents } from './ticket-channel.events';
import { TicketService } from '../../../domain/tickets/ticket.service';
import { ConfigService } from '@nestjs/config';

const guildId='123456789012345678';
const memberId='234567890123456789';
const staffId='345678901234567890';
const managerId='456789012345678901';
const botId='567890123456789012';
const roleId='678901234567890123';
const categoryId='789012345678901234';
const panelId='890123456789012345';
const ticketId='901234567890123456';
const panelMessageId='912345678901234567';
const controlsId='923456789012345678';

function setup(enabled=true){
 const permission={has:jest.fn().mockReturnValue(true)};
 const manager={id:managerId,user:{id:managerId,bot:false},
   permissions:{has:(flag:bigint)=>flag===PermissionFlagsBits.ManageGuild},
   roles:{cache:new Map()}};
 const staff={id:staffId,user:{id:staffId,bot:false},
   permissions:{has:()=>false},roles:{cache:new Map([[roleId,true]])}};
 const member={id:memberId,user:{id:memberId,bot:false},
   permissions:{has:()=>false},roles:{cache:new Map()}};
 const bot={id:botId,permissions:permission,user:{id:botId,bot:true}};
 const role={id:roleId,guild:{id:guildId}};
 const category={id:categoryId,guildId,type:ChannelType.GuildCategory,
   permissionsFor:()=>permission};
 const panelMessage={id:panelMessageId,delete:jest.fn().mockResolvedValue(undefined)};
 const controlMessage={id:controlsId};
 const panel={id:panelId,guildId,type:ChannelType.GuildText,
   permissionsFor:()=>permission,send:jest.fn().mockResolvedValue(panelMessage)};
 const ticket={id:ticketId,guildId,type:ChannelType.GuildText,
   permissionsFor:()=>permission,send:jest.fn().mockResolvedValue(controlMessage),
   permissionOverwrites:{edit:jest.fn().mockResolvedValue(undefined)}};
 const channels=new Map([[categoryId,category],[panelId,panel],[ticketId,ticket]]);
 const guild={id:guildId,
   members:{fetch:jest.fn(async({user}:{user:string})=>
     new Map([[memberId,member],[staffId,staff],[managerId,manager]]).get(user)||null),
     fetchMe:jest.fn().mockResolvedValue(bot)},
   roles:{fetch:jest.fn().mockResolvedValue(role)},
   channels:{fetch:jest.fn(async(id:string)=>channels.get(id)||null),
     create:jest.fn().mockResolvedValue(ticket)},
 };
 const config={guildId,categoryId,panelChannelId:panelId,staffRoleId:roleId,
   panelMessageId};
 const record={id:'7',guildId,openerId:memberId,staffRoleId:roleId,
   channelId:ticketId,controlMessageId:controlsId,status:'open',claimedById:null};
 const service={
   config:jest.fn().mockResolvedValue(config),configure:jest.fn().mockResolvedValue(config),
   bindPanel:jest.fn().mockResolvedValue(true),reserve:jest.fn().mockResolvedValue('7'),
   activate:jest.fn().mockResolvedValue(true),markCreateFailure:jest.fn().mockResolvedValue(true),
   byChannel:jest.fn().mockResolvedValue(record),claim:jest.fn().mockResolvedValue(true),
   release:jest.fn().mockResolvedValue(true),beginClose:jest.fn().mockResolvedValue(record),
   finishClose:jest.fn().mockResolvedValue(true),unresolved:jest.fn().mockResolvedValue([]),
   channelDeleted:jest.fn().mockResolvedValue(true),
 };
 const configService={get:()=>enabled?'true':'false'};
 const commands=new TicketCommands(service as unknown as TicketService,
   configService as unknown as ConfigService);
 const events=new TicketChannelEvents(service as unknown as TicketService,
   configService as unknown as ConfigService);
 function interaction(user:string,channelId=panelId,messageId=panelMessageId){
   return {guild,guildId,channelId,user:{id:user},message:{id:messageId},
     deferReply:jest.fn().mockResolvedValue(undefined),editReply:jest.fn().mockResolvedValue(undefined)};
 }
 return {guild,category,panel,ticket,role,manager,member,staff,bot,service,
   commands,events,interaction,record,panelMessage,config};
}

describe('Ticket Discord interactions: permissions and restart-safe persistence',()=>{
 it('feature is disabled by default and does not touch database or Discord',async()=>{
   const t=setup(false);
   const i=t.interaction(memberId);
   await t.commands.create([i] as any);
   expect(t.service.config).not.toHaveBeenCalled();
   expect(t.guild.channels.create).not.toHaveBeenCalled();
 });
 it('only fresh Manage Server members can configure the selected guild',async()=>{
   const t=setup();
   const i=t.interaction(memberId);
   const options={category:t.category,staffRole:t.role,panelChannel:t.panel};
   await t.commands.setup([i] as any,options as any);
   expect(t.service.configure).not.toHaveBeenCalled();
   const ok=t.interaction(managerId);
   await t.commands.setup([ok] as any,options as any);
   expect(t.service.configure).toHaveBeenCalledWith({
     guildId,categoryId,panelChannelId:panelId,staffRoleId:roleId,
   });
 });
 it('bot without Manage Roles cannot configure, create, or close private ticket overwrites',async()=>{
   const t=setup();
   t.bot.permissions.has.mockImplementation((flag:bigint)=>flag!==PermissionFlagsBits.ManageRoles);
   const opts={category:t.category,staffRole:t.role,panelChannel:t.panel};
   await t.commands.setup([t.interaction(managerId)] as any,opts as any);
   await t.commands.create([t.interaction(memberId)] as any);
   await t.commands.close([t.interaction(staffId,ticketId,controlsId)] as any);
   expect(t.service.configure).not.toHaveBeenCalled();
   expect(t.service.reserve).not.toHaveBeenCalled();
   expect(t.service.beginClose).not.toHaveBeenCalled();
 });
 it('saves panel message identity and deletes orphan post when DB bind fails',async()=>{
   const t=setup();
   await t.commands.panel([t.interaction(managerId)] as any);
   expect(t.service.bindPanel).toHaveBeenCalledWith(t.config,panelMessageId);
   t.service.bindPanel.mockResolvedValueOnce(false);
   await t.commands.panel([t.interaction(managerId)] as any);
   expect(t.panelMessage.delete).toHaveBeenCalled();
 });
 it('a stale or foreign creation panel never reserves a ticket',async()=>{
   const t=setup();
   await t.commands.create([t.interaction(memberId,panelId,controlsId)] as any);
   expect(t.service.reserve).not.toHaveBeenCalled();
 });
 it('the DB active slot wins before any Discord channel creation',async()=>{
   const t=setup();
   t.service.reserve.mockResolvedValueOnce(null);
   await t.commands.create([t.interaction(memberId)] as any);
   expect(t.guild.channels.create).not.toHaveBeenCalled();
 });
 it('creates private channel with explicit deny for everyone and no message transcript',async()=>{
   const t=setup();
   await t.commands.create([t.interaction(memberId)] as any);
   const options=t.guild.channels.create.mock.calls[0][0];
   expect(options.name).toBe('ticket-7');
   expect(options.parent).toBe(categoryId);
   expect(options.permissionOverwrites[0]).toEqual({id:guildId,
     deny:[PermissionFlagsBits.ViewChannel]});
   expect(options.permissionOverwrites.map((entry:{id:string})=>entry.id))
     .toEqual([guildId,memberId,roleId,botId]);
   expect(t.service.reserve.mock.invocationCallOrder[0])
     .toBeLessThan(t.guild.channels.create.mock.invocationCallOrder[0]);
   expect(t.service.activate).toHaveBeenCalledWith(guildId,'7',memberId,ticketId,controlsId);
   expect(t.ticket.send.mock.calls[0][0].allowedMentions).toEqual({parse:[]});
 });
 it('unknown Discord result holds ticket for review; never blindly tries again',async()=>{
   const t=setup();
   t.guild.channels.create.mockRejectedValueOnce(new Error('timeout'));
   await t.commands.create([t.interaction(memberId)] as any);
   expect(t.service.markCreateFailure).toHaveBeenCalledWith(guildId,'7',memberId,false);
   expect(t.guild.channels.create).toHaveBeenCalledTimes(1);
 });
 it('known permission rejection can safely release the uncreated ticket slot',async()=>{
   const t=setup();
   t.guild.channels.create.mockRejectedValueOnce({code:50013});
   await t.commands.create([t.interaction(memberId)] as any);
   expect(t.service.markCreateFailure).toHaveBeenCalledWith(guildId,'7',memberId,true);
 });
 it('after channel creation, failed control message is never classified no-effect',async()=>{
   const t=setup();
   t.ticket.send.mockRejectedValueOnce(new Error('network response lost'));
   await t.commands.create([t.interaction(memberId)] as any);
   expect(t.service.markCreateFailure).toHaveBeenCalledWith(guildId,'7',memberId,false);
 });
 it('member cannot claim and old control messages cannot change staff assignment',async()=>{
   const t=setup();
   await t.commands.claim([t.interaction(memberId,ticketId,controlsId)] as any);
   await t.commands.claim([t.interaction(staffId,ticketId,panelMessageId)] as any);
   expect(t.service.claim).not.toHaveBeenCalled();
 });
 it('staff claim/release are guild-bound; manager override is explicit',async()=>{
   const t=setup();
   await t.commands.claim([t.interaction(staffId,ticketId,controlsId)] as any);
   await t.commands.release([t.interaction(staffId,ticketId,controlsId)] as any);
   await t.commands.release([t.interaction(managerId,ticketId,controlsId)] as any);
   expect(t.service.claim).toHaveBeenCalledWith(guildId,ticketId,staffId);
   expect(t.service.release).toHaveBeenNthCalledWith(1,guildId,ticketId,staffId,false);
   expect(t.service.release).toHaveBeenNthCalledWith(2,guildId,ticketId,managerId,true);
 });
 it('closing writes a pending audit BEFORE touching Discord permission overwrites',async()=>{
   const t=setup();
   await t.commands.close([t.interaction(staffId,ticketId,controlsId)] as any);
   expect(t.service.beginClose.mock.invocationCallOrder[0])
     .toBeLessThan(t.ticket.permissionOverwrites.edit.mock.invocationCallOrder[0]);
   expect(t.ticket.permissionOverwrites.edit).toHaveBeenCalledWith(
     memberId,{SendMessages:false,SendMessagesInThreads:false,
       CreatePublicThreads:false,CreatePrivateThreads:false,AddReactions:false},expect.any(Object));
   expect(t.service.finishClose).toHaveBeenCalledWith(guildId,ticketId,staffId,true);
 });
 it('lost close result is kept in needs_review, never auto-repeated',async()=>{
   const t=setup();
   t.ticket.permissionOverwrites.edit.mockRejectedValueOnce(new Error('timeout'));
   await t.commands.close([t.interaction(staffId,ticketId,controlsId)] as any);
   expect(t.service.finishClose).toHaveBeenCalledWith(guildId,ticketId,staffId,false);
   expect(t.ticket.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
 });
 it('unexpected deletion audits the bound guild channel without recreating it',async()=>{
   const t=setup();
   await t.events.onDeleted([{guildId,id:ticketId}] as any);
   expect(t.service.channelDeleted).toHaveBeenCalledWith(guildId,ticketId);
   expect(t.guild.channels.create).not.toHaveBeenCalled();
 });
});
