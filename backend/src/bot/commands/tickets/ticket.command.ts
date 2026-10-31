import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Button, ChannelOption, Context, Options, RoleOption, Subcommand,
  createCommandGroupDecorator } from 'necord';
import type { ButtonContext, SlashCommandContext } from 'necord';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, GuildChannel,
  GuildMember, MessageFlags, PermissionFlagsBits, Role, TextChannel,
} from 'discord.js';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { TicketService } from '../../../domain/tickets/ticket.service';
import { TICKET_FEATURE_FLAG, isDefinitiveChannelCreateRejection,
  privateTicketOverwrites, ticketChannelName, ticketStaffAllowed, validTicketSetup,
} from '../../../domain/tickets/ticket-policy';

const TicketGroup = createCommandGroupDecorator({
  name: 'ticket', description: 'Private support tickets and staff controls',
});

class TicketSetupOptions {
  @ChannelOption({ name: 'category', description: 'Category containing PRIVATE tickets',
    channelTypes: [ChannelType.GuildCategory], required: true })
  category!: GuildChannel;
  @RoleOption({ name: 'staff_role', description: 'Role allowed to read and manage tickets',
    required: true })
  staffRole!: Role;
  @ChannelOption({ name: 'panel_channel', description: 'Public text channel for ticket panel',
    channelTypes: [ChannelType.GuildText], required: true })
  panelChannel!: GuildChannel;
}

function controls() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket-claim').setLabel('Claim').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket-release').setLabel('Release').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket-close').setLabel('Close').setStyle(ButtonStyle.Danger),
  );
}

@TicketGroup()
@Injectable()
export class TicketCommands {
  constructor(private readonly tickets: TicketService, private readonly config: ConfigService) {}

  private enabled():boolean {
    return this.config.get<string>(TICKET_FEATURE_FLAG) === 'true';
  }

  private async manager(interaction: ChatInputCommandInteraction):Promise<GuildMember|null> {
    if(!interaction.guild) return null;
    const actor=await interaction.guild.members.fetch({user:interaction.user.id,force:true})
      .catch(()=>null);
    return actor?.permissions.has(PermissionFlagsBits.ManageGuild) ? actor : null;
  }

  @Subcommand({name:'setup',description:'Configure a private ticket category, staff role and panel channel'})
  async setup(@Context() [interaction]:SlashCommandContext,
    @Options() {category,staffRole,panelChannel}:TicketSetupOptions) {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    if(!this.enabled())return interaction.editReply('Tickets are disabled until staging approval.');
    const guild=interaction.guild;
    if(!guild || !await this.manager(interaction))return interaction.editReply('Manage Server is required.');
    if(!validTicketSetup({guildId:guild.id,categoryId:category?.id,
      staffRoleId:staffRole?.id,panelChannelId:panelChannel?.id}) ||
      category.guildId!==guild.id || panelChannel.guildId!==guild.id ||
      staffRole.guild.id!==guild.id)return interaction.editReply('Invalid category, role or panel channel.');
    const [categoryLive,panelLive,role,bot] = await Promise.all([
      guild.channels.fetch(category.id).catch(()=>null),
      guild.channels.fetch(panelChannel.id).catch(()=>null),
      guild.roles.fetch(staffRole.id).catch(()=>null),
      guild.members.fetchMe().catch(()=>null),
    ]);
    if(!bot || !role || role.id===guild.id ||
       categoryLive?.type!==ChannelType.GuildCategory ||
       panelLive?.type!==ChannelType.GuildText ||
       !bot.permissions.has(PermissionFlagsBits.ManageChannels) ||
       !categoryLive.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels) ||
       !panelLive.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
       !panelLive.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.editReply('Check the bot’s Manage Channels and panel posting permissions.');
    }
    await this.tickets.configure({guildId:guild.id,categoryId:category.id,
      panelChannelId:panelChannel.id,staffRoleId:role.id});
    return interaction.editReply('Ticket settings saved. Run `/ticket panel` to post the new button. Existing panels are disabled.');
  }

  @Subcommand({name:'panel',description:'Post the current configured ticket creation panel'})
  async panel(@Context() [interaction]:SlashCommandContext) {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    if(!this.enabled())return interaction.editReply('Tickets are disabled until staging approval.');
    const guild=interaction.guild;
    if(!guild || !await this.manager(interaction))return interaction.editReply('Manage Server is required.');
    const config=await this.tickets.config(guild.id);
    if(!config)return interaction.editReply('Run `/ticket setup` first.');
    const [panel,role,bot]=await Promise.all([
      guild.channels.fetch(config.panelChannelId).catch(()=>null),
      guild.roles.fetch(config.staffRoleId).catch(()=>null),
      guild.members.fetchMe().catch(()=>null),
    ]);
    if(!panel || panel.type!==ChannelType.GuildText || !role || !bot ||
      !panel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
      !panel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
      return interaction.editReply('Configured panel is unavailable or bot cannot post there.');
    }
    const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('ticket-create').setLabel('Open private ticket')
        .setStyle(ButtonStyle.Primary),
    );
    const message=await (panel as TextChannel).send({
      content:'Need private help? Select **Open private ticket**. Only you and designated staff can access the channel (server administrators retain access). One active ticket per member.',
      components:[row],allowedMentions:{parse:[]},
    });
    let bound=false;
    try{bound=await this.tickets.bindPanel(config,message.id);}catch{ /* clean up inert panel */ }
    if(!bound){await message.delete().catch(()=>undefined);
      return interaction.editReply('The configuration changed while posting. Retry with current settings.');}
    return interaction.editReply('Ticket panel published in <#'+panel.id+'>.');
  }

  @Subcommand({name:'review',description:'List tickets requiring staff reconciliation'})
  async review(@Context() [interaction]:SlashCommandContext) {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    if(!this.enabled())return interaction.editReply('Tickets are disabled until staging approval.');
    const guild=interaction.guild;
    if(!guild || !await this.manager(interaction))return interaction.editReply('Manage Server is required.');
    const rows=await this.tickets.unresolved(guild.id);
    if(!rows.length)return interaction.editReply('No unresolved tickets in this guild.');
    const items=rows.map(row=>'#'+row.id+' '+row.status+' opener='+row.openerId+
      (row.channelId?' channel='+row.channelId:'')+
      (row.lastErrorCode?' reason='+row.lastErrorCode:'')).join('\n');
    return interaction.editReply('Ticket reconciliation queue (max 20):\n'+items.slice(0,1750)+
      '\nVerify Discord channels before any manual recovery; uncertain effects are never auto-replayed.');
  }

  @Button('ticket-create')
  async create(@Context() [interaction]:ButtonContext) {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    if(!this.enabled())return interaction.editReply('Tickets are not currently enabled.');
    const guild=interaction.guild;
    if(!guild || !interaction.guildId)return interaction.editReply('Tickets require a server.');
    const config=await this.tickets.config(guild.id);
    if(!config || config.panelMessageId!==interaction.message.id ||
       config.panelChannelId!==interaction.channelId) {
      return interaction.editReply('This ticket panel is no longer active.');
    }
    const [member,bot,role,category]=await Promise.all([
      guild.members.fetch({user:interaction.user.id,force:true}).catch(()=>null),
      guild.members.fetchMe().catch(()=>null),
      guild.roles.fetch(config.staffRoleId).catch(()=>null),
      guild.channels.fetch(config.categoryId).catch(()=>null),
    ]);
    if(!member || member.user.bot || !bot || !role || role.id===guild.id ||
       category?.type!==ChannelType.GuildCategory ||
       !bot.permissions.has(PermissionFlagsBits.ManageChannels) ||
       !category.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply('Private ticket creation is unavailable; notify server staff.');
    }
    const overwrites=privateTicketOverwrites(guild.id,member.id,role.id,bot.id,
      PermissionFlagsBits);
    // Reserve in DB BEFORE any external side effect. The partial unique index
    // enforces one active or uncertain ticket across processes/restarts.
    const ticketId=await this.tickets.reserve(guild.id,member.id,interaction.message.id);
    if(!ticketId)return interaction.editReply('An active or unresolved ticket already exists, or this panel changed. Ask staff to review it.');
    let channel:TextChannel|null=null;
    try {
      const opened: TextChannel = await guild.channels.create({
        name:ticketChannelName(ticketId),type:ChannelType.GuildText,
        parent:config.categoryId,permissionOverwrites:overwrites,
        topic:'Yuugen ticket #'+ticketId+' | opener '+member.id,
        reason:'Yuugen private support ticket #'+ticketId,
      });
      channel=opened;
      const control=await opened.send({
        content:'Support ticket #'+ticketId+' opened by <@'+member.id+'>. Staff can claim, release or close it. No message transcript is stored by the bot.',
        components:[controls()],allowedMentions:{parse:[]},
      });
      const activated=await this.tickets.activate(guild.id,ticketId,member.id,
        opened.id,control.id);
      if(!activated)throw new Error('Ticket could not be activated');
    } catch(error) {
      // If creation may have reached Discord, NEVER auto-create another
      // channel. Hold this slot for manual verification using ticket ID/topic.
      const noEffect=!channel && isDefinitiveChannelCreateRejection(error);
      await this.tickets.markCreateFailure(guild.id,ticketId,member.id,noEffect)
        .catch(()=>undefined);
      return interaction.editReply(noEffect
        ?'Discord refused to create this channel. Ask staff to check permissions.'
        :'Ticket outcome is uncertain. Staff must check for ticket #'+ticketId+' before retrying.');
    }
    if (!channel) return interaction.editReply('Ticket requires staff review.');
    return interaction.editReply({content:'Private ticket created: <#'+channel.id+'>',
      allowedMentions:{parse:[]}});
  }

  private async act(interaction:ButtonInteraction, action:'claim'|'release'|'close') {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    if(!this.enabled())return interaction.editReply('Tickets are not currently enabled.');
    const guild=interaction.guild;
    if(!guild || !interaction.channelId)return interaction.editReply('Not a server ticket.');
    const ticket=await this.tickets.byChannel(guild.id,interaction.channelId);
    if(!ticket || ticket.status!=='open' ||
       ticket.controlMessageId!==interaction.message.id) {
      return interaction.editReply('This ticket control is stale or no longer open.');
    }
    const [actor,role,bot,channel]=await Promise.all([
      guild.members.fetch({user:interaction.user.id,force:true}).catch(()=>null),
      guild.roles.fetch(ticket.staffRoleId).catch(()=>null),
      guild.members.fetchMe().catch(()=>null),
      guild.channels.fetch(interaction.channelId).catch(()=>null),
    ]);
    const manager=!!actor?.permissions.has(PermissionFlagsBits.ManageGuild);
    if(!actor || (!manager && (!role || !ticketStaffAllowed(
       actor.roles.cache.keys(),ticket.staffRoleId,false)))) {
      return interaction.editReply('Only the configured support staff or server managers can use these controls.');
    }
    if(!bot || !channel || channel.type!==ChannelType.GuildText ||
      !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
      (action==='close' && !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels))) {
      return interaction.editReply('Ticket permissions changed; ask an administrator to review.');
    }
    if(action==='claim') {
      const ok=await this.tickets.claim(guild.id,channel.id,actor.id);
      return interaction.editReply(ok?'Ticket assigned to you.':'Ticket was already claimed or closed.');
    }
    if(action==='release') {
      const ok=await this.tickets.release(guild.id,channel.id,actor.id,manager);
      return interaction.editReply(ok?'Ticket assignment released.':'Only the claimant or server manager can release an active assignment.');
    }
    const pending=await this.tickets.beginClose(guild.id,channel.id,actor.id);
    if(!pending)return interaction.editReply('Ticket was already closing or closed.');
    try {
      await (channel as TextChannel).permissionOverwrites.edit(pending.openerId,
        {SendMessages:false,SendMessagesInThreads:false,CreatePublicThreads:false,
         CreatePrivateThreads:false,AddReactions:false},
        {reason:'Yuugen ticket #'+pending.id+' closed by staff'});
      const done=await this.tickets.finishClose(guild.id,channel.id,actor.id,true);
      if(!done)throw new Error('Ticket was not finalized');
    } catch {
      await this.tickets.finishClose(guild.id,channel.id,actor.id,false)
        .catch(()=>undefined);
      return interaction.editReply('Close outcome uncertain. A server manager must verify channel posting permissions before manual reconciliation.');
    }
    // Keep the private channel read-only for participants and preserve the
    // Discord conversation; transcript storage/export is outside #65.
    await (channel as TextChannel).send({content:'Ticket closed by staff. This channel is now read-only for the opener.',
      allowedMentions:{parse:[]}}).catch(()=>undefined);
    return interaction.editReply('Ticket closed, audited and made read-only.');
  }

  @Button('ticket-claim')
  async claim(@Context() [interaction]:ButtonContext) {return this.act(interaction,'claim');}
  @Button('ticket-release')
  async release(@Context() [interaction]:ButtonContext) {return this.act(interaction,'release');}
  @Button('ticket-close')
  async close(@Context() [interaction]:ButtonContext) {return this.act(interaction,'close');}
}
