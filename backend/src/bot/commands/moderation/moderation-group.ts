import { createCommandGroupDecorator } from 'necord';

/**
 * Reuse the same /mod root for flat moderation commands and nested
 * /mod voice <action> subcommands.
 */
export const ModerationGroup = createCommandGroupDecorator({
  name: 'mod',
  description: 'Server moderation and case history',
});
