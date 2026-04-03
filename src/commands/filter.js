const { REST, Routes } = require('discord.js');

const filterCommands = [
  {
    name: 'filter',
    description: 'Manage AI response filters for this server.',
    options: [
      {
        name: 'add',
        description: 'Add a word to the filter list.',
        type: 1,
        options: [{ name: 'word', description: 'The word to add to the filter.', type: 3, required: true }],
      },
      {
        name: 'remove',
        description: 'Remove a word from the filter list.',
        type: 1,
        options: [{ name: 'word', description: 'The word to remove from the filter.', type: 3, required: true }],
      },
      { name: 'list', description: 'List current filtered words.', type: 1 },
    ],
  },
];

async function registerFilterCommands({ token, clientId, guildId }) {
  if (!clientId) {
    console.warn('Skipping slash command registration: client ID is missing.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: filterCommands,
    });
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), {
    body: filterCommands,
  });
}

async function handleFilterInteraction({ interaction, databaseService, ownerBypassId }) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'filter') {
    return false;
  }

  const userId = interaction.user.id;
  const guild = interaction.guild;

  if (userId !== ownerBypassId && guild && userId !== guild.ownerId) {
    await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    return true;
  }

  if (!guild && userId !== ownerBypassId) {
    await interaction.reply({
      content: 'This command can only be used by the bot owner in DMs.',
      ephemeral: true,
    });
    return true;
  }

  const subCommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (subCommand === 'add') {
    const word = interaction.options.getString('word').toLowerCase();
    const added = await databaseService.addFilteredWord(guildId, word);
    await interaction.reply({
      content: added ? `Added "${word}" to the filter list.` : `"${word}" is already in the filter list.`,
      ephemeral: true,
    });
    return true;
  }

  if (subCommand === 'remove') {
    const word = interaction.options.getString('word').toLowerCase();
    const removed = await databaseService.removeFilteredWord(guildId, word);
    await interaction.reply({
      content: removed ? `Removed "${word}" from the filter list.` : `"${word}" was not found.`,
      ephemeral: true,
    });
    return true;
  }

  if (subCommand === 'list') {
    const words = await databaseService.getFilteredWords(guildId);
    await interaction.reply({
      content: words.length ? `Filtered words: ${words.join(', ')}` : 'There are no filtered words for this server.',
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  filterCommands,
  handleFilterInteraction,
  registerFilterCommands,
};
