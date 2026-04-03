const { Buffer } = require('buffer');
const axios = require('axios');
const { ChannelType, Client, GatewayIntentBits } = require('discord.js');
const { readConfig } = require('./config');
const { handleFilterInteraction, registerFilterCommands } = require('./commands/filter');
const { AiService } = require('./services/ai');
const { DatabaseService } = require('./services/database');
const { VoiceService } = require('./services/voice');
const { cleanAiResponse, extractSearchQuery, formatHistory } = require('./utils/text');

const config = readConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const databaseService = new DatabaseService({
  dbFile: config.dbFile,
  ramCacheSize: config.ramCacheSize,
});

const aiService = new AiService({
  ollamaApiUrl: config.ollamaApiUrl,
  ollamaModel: config.ollamaModel,
  ollamaVisionModel: config.ollamaVisionModel,
  googleCseApiKey: config.googleCseApiKey,
  googleCseId: config.googleCseId,
});

const voiceService = new VoiceService({
  whisperTranscribeEndpoint: config.whisperTranscribeEndpoint,
  client,
});

async function sendAiReply({ message, history, guildId }) {
  const formattedHistory = formatHistory(history);
  const initialPrompt = `${config.aiTriggeredMessagePrompt}\n${formattedHistory}User: ${message.content}\nAI:`;

  let aiResponse = cleanAiResponse(await aiService.generateResponse(initialPrompt));
  const searchQuery = extractSearchQuery(aiResponse);

  if (searchQuery) {
    const searchResult = await aiService.search(searchQuery);
    const followUpPrompt = `${config.aiTriggeredMessagePrompt}\n${formattedHistory}User: ${message.content}\nAI (Initial Response): ${aiResponse}\n\n--- SEARCH RESULTS FOR "${searchQuery}" ---\n${searchResult}\n--- END SEARCH RESULTS ---\n\nAI (Final Response):`;
    aiResponse = cleanAiResponse(await aiService.generateResponse(followUpPrompt));
  }

  if (databaseService.containsFilteredWord(aiResponse, guildId)) {
    await message.channel.send('My response contained filtered words and could not be sent.');
    return;
  }

  const sentMessage = await message.channel.send(aiResponse);
  await databaseService.saveBotMessage(message.channel.id, sentMessage, client.user.username);
  databaseService.addToHistory(message.channel.id, {
    author: client.user.username,
    content: sentMessage.content,
    type: 'bot',
  });
}

async function processImageMessage(message, history) {
  const imageAttachment = message.attachments.find(
    (attachment) => attachment.contentType && attachment.contentType.startsWith('image/')
  );

  const isTriggered =
    message.mentions.users.has(client.user.id) || message.content.toLowerCase().startsWith('!analyze');

  if (!imageAttachment || !isTriggered) {
    return false;
  }

  let imagePrompt = config.aiImagePrompt;

  if (message.content.toLowerCase().startsWith('!analyze')) {
    imagePrompt = message.content.slice('!analyze'.length).trim() || config.aiImagePrompt;
  } else if (message.mentions.users.has(client.user.id)) {
    imagePrompt = message.content.replace(`<@${client.user.id}>`, '').trim() || config.aiImagePrompt;
  }

  const response = await axios.get(imageAttachment.url, { responseType: 'arraybuffer' });
  const imageBuffer = Buffer.from(response.data);
  const analysisResult = await aiService.processImage(imageBuffer, imagePrompt);

  const historyWithAnalysis = [
    ...history,
    {
      author: client.user.username,
      content: `AI analyzed image: ${analysisResult}`,
      type: 'bot_analysis',
    },
  ];

  const combinedHistory = formatHistory(historyWithAnalysis);
  const finalPrompt = `${config.aiTriggeredMessagePrompt}\n${combinedHistory}User: ${message.content}\nAI:`;
  let finalResponse = cleanAiResponse(await aiService.generateResponse(finalPrompt));

  const searchQuery = extractSearchQuery(finalResponse);
  if (searchQuery) {
    const searchResult = await aiService.search(searchQuery);
    finalResponse = finalResponse.replace(`[SEARCH:${searchQuery}]`, `(Search Result: ${searchResult})`);
  }

  if (databaseService.containsFilteredWord(finalResponse, message.guildId)) {
    await message.channel.send('My response contained filtered words and could not be sent.');
    return true;
  }

  const sentMessage = await message.channel.send(finalResponse);
  await databaseService.saveBotMessage(message.channel.id, sentMessage, client.user.username);
  databaseService.addToHistory(message.channel.id, {
    author: client.user.username,
    content: sentMessage.content,
    type: 'bot',
  });

  return true;
}

async function handleDirectSearch(message) {
  const query = message.content.slice('!search '.length).trim();
  if (!query) {
    await message.reply('Please provide a search query after !search.');
    return;
  }

  const result = await aiService.search(query);
  await message.channel.send(`Search result for "${query}": ${result}`);
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await databaseService.init();
    await registerFilterCommands({
      token: config.token,
      clientId: config.clientId,
      guildId: config.guildId,
    });
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }

  if (config.channelsToMessage.length > 0 && config.sendRandomMessagesInterval > 0) {
    setInterval(async () => {
      const randomChannelId =
        config.channelsToMessage[Math.floor(Math.random() * config.channelsToMessage.length)];
      const channel = client.channels.cache.get(randomChannelId);
      if (!channel) {
        return;
      }

      try {
        const aiResponse = cleanAiResponse(await aiService.generateResponse(config.aiRandomMessagePrompt));
        const sentMessage = await channel.send(aiResponse);
        await databaseService.saveBotMessage(channel.id, sentMessage, client.user.username);
      } catch (error) {
        console.error('Error sending random AI message:', error);
      }
    }, config.sendRandomMessagesInterval);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleFilterInteraction({
      interaction,
      databaseService,
      ownerBypassId: config.ownerBypassId,
    });
  } catch (error) {
    console.error('Interaction error:', error);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({ content: 'Command failed to run.', ephemeral: true });
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) {
    return;
  }

  const isDm = message.channel.type === ChannelType.DM;
  const conversationId = isDm ? message.author.id : message.channel.id;

  await databaseService.saveUserMessage(conversationId, message);
  const history = await databaseService.ensureHistory(conversationId);
  databaseService.addToHistory(conversationId, {
    author: message.author.username,
    content: message.content,
    type: 'user',
  });

  if (isDm) {
    if (!config.ollamaApiUrl || !config.ollamaModel) {
      await message.channel.send('AI functionality is not configured for DMs.');
      return;
    }

    try {
      await sendAiReply({ message, history, guildId: null });
    } catch (error) {
      console.error('Error processing DM:', error);
      await message.channel.send('Sorry, I had trouble processing that with AI.');
    }
    return;
  }

  try {
    const imageHandled = await processImageMessage(message, history);
    if (imageHandled) {
      return;
    }
  } catch (error) {
    console.error('Error processing image flow:', error);
    await message.channel.send('Sorry, I had trouble processing that image.');
    return;
  }

  if (config.ollamaApiUrl && config.ollamaModel && message.mentions.users.has(client.user.id)) {
    try {
      await sendAiReply({ message, history, guildId: message.guildId });
    } catch (error) {
      console.error('Error generating AI message:', error);
      await message.channel.send('Sorry, I had trouble generating a response.');
    }
  }

  if (message.content.toLowerCase().startsWith('!join')) {
    await voiceService.handleJoinCommand(message);
  } else if (message.content.toLowerCase().startsWith('!leave')) {
    await voiceService.handleLeaveCommand(message);
  } else if (message.content.toLowerCase().startsWith('!search ')) {
    await handleDirectSearch(message);
  }
});

client.on('error', console.error);
client.on('warn', console.warn);

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', async () => {
  try {
    await databaseService.close();
  } catch (error) {
    console.error('Error closing database:', error);
  }
  process.exit(0);
});

client.login(config.token);
