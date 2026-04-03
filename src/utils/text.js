function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanAiResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return responseText;
  }

  const cleanedText = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return cleanedText || "Hmm, I processed something but it didn't make sense! Can you try again?";
}

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }

  return `${history
    .map((msg) => {
      if (msg.type === 'user') {
        return `User: ${msg.content}`;
      }
      if (msg.type === 'bot') {
        return `AI: ${msg.content}`;
      }
      if (msg.type === 'bot_analysis') {
        return `AI analyzed image: ${msg.content}`;
      }
      return `${msg.author}: ${msg.content}`;
    })
    .join('\n')}\n`;
}

function extractSearchQuery(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const match = text.match(/\[SEARCH:(.*?)\]/i);
  return match && match[1] ? match[1].trim() : null;
}

module.exports = {
  cleanAiResponse,
  escapeRegExp,
  extractSearchQuery,
  formatHistory,
};
