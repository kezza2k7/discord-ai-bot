const axios = require('axios');

class AiService {
  constructor({
    ollamaApiUrl,
    ollamaModel,
    ollamaVisionModel,
    googleCseApiKey,
    googleCseId,
  }) {
    this.ollamaApiUrl = ollamaApiUrl;
    this.ollamaModel = ollamaModel;
    this.ollamaVisionModel = ollamaVisionModel;
    this.googleCseApiKey = googleCseApiKey;
    this.googleCseId = googleCseId;
  }

  async generateResponse(prompt) {
    if (!this.ollamaApiUrl || !this.ollamaModel) {
      throw new Error('Ollama API URL or model is not configured.');
    }

    try {
      const response = await axios.post(`${this.ollamaApiUrl}/api/generate`, {
        model: this.ollamaModel,
        prompt,
        stream: false,
      });

      return response.data.response ? response.data.response.trim() : "I'm confused!";
    } catch (error) {
      throw this.toRequestError(error, 'Ollama AI response');
    }
  }

  async processImage(imageBuffer, prompt) {
    if (!this.ollamaApiUrl || !this.ollamaVisionModel) {
      throw new Error('Ollama API URL or vision model is not configured.');
    }

    try {
      const response = await axios.post(`${this.ollamaApiUrl}/api/generate`, {
        model: this.ollamaVisionModel,
        prompt,
        images: [imageBuffer.toString('base64')],
        stream: false,
      });

      return response.data.response || 'Could not process image.';
    } catch (error) {
      throw this.toRequestError(error, 'Ollama image processing');
    }
  }

  async search(query) {
    if (!this.googleCseApiKey || !this.googleCseId) {
      return '[search_error: Google CSE API Key or ID is not configured.]';
    }

    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${this.googleCseApiKey}&cx=${this.googleCseId}`;

    try {
      const response = await axios.get(url);
      const items = response.data.items || [];
      if (!items.length) {
        return 'No search results found.';
      }

      return items
        .map((item, index) => {
          const snippet = item.snippet || 'No snippet available.';
          const shortSnippet = snippet.length > 200 ? `${snippet.slice(0, 197)}...` : snippet;
          return `${index + 1}. ${item.title || 'No Title'}: ${item.link || 'No Link'} - ${shortSnippet}`;
        })
        .join('\n');
    } catch (error) {
      if (error.response) {
        return `[search_error: Received status ${error.response.status} - ${JSON.stringify(error.response.data)}]`;
      }
      if (error.request) {
        return '[search_error: No response received from Google Search API.]';
      }
      return `[search_error: Error setting up search request: ${error.message}]`;
    }
  }

  toRequestError(error, label) {
    if (error.response) {
      return new Error(`${label} error: Status ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    if (error.request) {
      return new Error(`No response received for ${label}.`);
    }
    return new Error(`Error setting up ${label} request: ${error.message}`);
  }
}

module.exports = {
  AiService,
};
