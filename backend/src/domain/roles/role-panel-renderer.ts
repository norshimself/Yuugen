import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, escapeMarkdown,
} from 'discord.js';
import {
  buttonCustomId, selectCustomId, validatePanelOptions,
  type RolePanelDefinition,
} from './role-panel-policy';

/** Message content contains only admin-supplied bounded labels and static text. */
export function renderRolePanel(panel: RolePanelDefinition) {
  const denial = validatePanelOptions(panel.mode, panel.options);
  if (denial || panel.options.length === 0) {
    throw new Error('Cannot render panel: ' + (denial || 'empty options'));
  }
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (panel.mode === 'buttons') {
    for (let offset = 0; offset < panel.options.length; offset += 5) {
      const row = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>();
      for (const option of panel.options.slice(offset, offset + 5)) {
        row.addComponents(new ButtonBuilder()
          .setCustomId(buttonCustomId(panel.id, panel.revision, option.id))
          .setLabel(option.label)
          .setStyle(ButtonStyle.Secondary));
      }
      rows.push(row);
    }
  } else {
    const options = panel.options.map(option =>
      new StringSelectMenuOptionBuilder()
        .setLabel(option.label)
        .setValue(String(option.id))
        .setDescription(option.prerequisiteRoleId
          ? 'Requires a prerequisite role' : 'Toggle this role'),
    );
    rows.push(new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>()
      .addComponents(new StringSelectMenuBuilder()
        .setCustomId(selectCustomId(panel.id, panel.revision))
        .setPlaceholder('Choose a role to add or remove')
        .setMinValues(1).setMaxValues(1)
        .addOptions(...options)));
  }
  return {
    content: '**' + escapeMarkdown(panel.title) + '**\n' +
      'Choose one option to add or remove a role. Exclusive choices replace your other selections in the same group.',
    components: rows,
    allowedMentions: { parse: [] as [] },
  };
}
