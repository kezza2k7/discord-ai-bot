const fs = require('fs');

function readConfig() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  } catch (error) {
    console.error('Error loading config.json:', error.message);
    console.error('Please ensure config.json exists and is valid JSON.');
    process.exit(1);
  }

  const config = {
    token: parsed.token,
    clientId: parsed.client_id,
    guildId: parsed.guild_id,
    ownerBypassId: parsed.owner_bypass_id,
    dbFile: parsed.database_file || 'miku_history.db',
    ramCacheSize: parsed.ram_cache_size || 50,
    ollamaApiUrl: parsed.ollama_api_url,
    ollamaModel: parsed.ollama_model,
    ollamaVisionModel: parsed.ollama_vision_model || 'llava',
    googleCseApiKey: parsed.google_cse_api_key,
    googleCseId: parsed.google_cse_id,
    pythonBackendUrl: parsed.python_backend_url || 'http://localhost:5000',
    whisperTranscribeEndpoint: `${parsed.python_backend_url || 'http://localhost:5000'}/transcribe`,
    channelsToMessage: parsed.channels_to_message || [],
    sendRandomMessagesInterval: parsed.send_random_messages_interval || 3600 * 1000,
    aiRandomMessagePrompt: parsed.ai_random_message_prompt || 'Generate a random message.',
    aiTriggeredMessagePrompt:
      parsed.ai_triggered_message_prompt ||
      parsed.ai_triggered_MESSAGE_PROMPT ||
      'Respond to the user message based on the conversation history.',
    aiImagePrompt: parsed.ai_image_prompt || 'Describe this image.',
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  if (!config.token || config.token === 'YOUR_BOT_TOKEN') {
    console.error("Error: Please replace 'YOUR_BOT_TOKEN' with your actual bot token in config.json.");
    process.exit(1);
  }

  if (!config.clientId || config.clientId === 'YOUR_CLIENT_ID') {
    console.warn('Warning: CLIENT_ID is not configured. Slash commands may not work.');
  }

  if (!config.ollamaApiUrl || !config.ollamaModel) {
    console.warn('Warning: Ollama API URL or model is missing. AI functionality may not work.');
  }

  if (!config.googleCseApiKey || !config.googleCseId) {
    console.warn('Warning: Google CSE key or ID is missing. Search functionality may not work.');
  }
}

module.exports = {
  readConfig,
};
