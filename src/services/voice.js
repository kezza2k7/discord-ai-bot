const axios = require('axios');
const {
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} = require('@discordjs/voice');

class VoiceService {
  constructor({ whisperTranscribeEndpoint, client }) {
    this.whisperTranscribeEndpoint = whisperTranscribeEndpoint;
    this.client = client;
    this.voiceReceivers = new Map();
  }

  async handleJoinCommand(message) {
    if (!message.guild || !message.member || !message.member.voice.channel) {
      await message.reply('You need to be in a voice channel to make me join.');
      return;
    }

    const voiceChannel = message.member.voice.channel;
    const existingConnection = getVoiceConnection(message.guild.id);
    if (existingConnection) {
      await message.reply("I'm already in a voice channel in this server.");
      return;
    }

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      connection.on(VoiceConnectionStatus.Ready, () => {
        message.channel.send(`Joined voice channel: ${voiceChannel.name}`);
        this.startListening(connection, message.channel);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch (error) {
          this.voiceReceivers.delete(message.guild.id);
          message.channel.send('Disconnected from voice channel.');
        }
      });
    } catch (error) {
      console.error('Error joining voice channel:', error);
      await message.reply('Failed to join the voice channel.');
    }
  }

  async handleLeaveCommand(message) {
    if (!message.guild) {
      await message.reply('This command only works in servers.');
      return;
    }

    const connection = getVoiceConnection(message.guild.id);
    if (!connection) {
      await message.reply('I am not in a voice channel in this server.');
      return;
    }

    connection.destroy();
    this.voiceReceivers.delete(message.guild.id);
    await message.reply('Left the voice channel.');
  }

  startListening(connection, textChannel) {
    const receiver = connection.receiver;
    if (!receiver) {
      textChannel.send('Error setting up voice receiver.');
      return;
    }

    this.voiceReceivers.set(textChannel.guild.id, receiver);
    textChannel.send('Started listening for audio...');

    receiver.speaking.on('start', (userId) => {
      if (typeof receiver.createAudioStream !== 'function') {
        textChannel.send('Voice recording is not supported in this environment.');
        return;
      }

      const audioStream = receiver.createAudioStream(userId, {
        mode: 'pcm',
        end: 'silence',
        endThreshold: 1000,
        decode: true,
      });

      const chunks = [];
      audioStream.on('data', (chunk) => chunks.push(chunk));
      audioStream.on('error', (error) => {
        console.error(`Error in audio stream for user ${userId}:`, error);
      });

      audioStream.on('end', async () => {
        const audioBuffer = Buffer.concat(chunks);
        if (!audioBuffer.length) {
          return;
        }

        try {
          const transcription = await this.transcribeAudio(audioBuffer);
          const user = this.client.users.cache.get(userId);
          const username = user ? user.username : `User ID ${userId}`;
          await textChannel.send(`${username}: ${transcription}`);
        } catch (error) {
          console.error('Error transcribing audio:', error);
          await textChannel.send(`Error processing audio from User ID ${userId}.`);
        }
      });
    });
  }

  async transcribeAudio(audioBuffer) {
    if (!this.whisperTranscribeEndpoint) {
      throw new Error('Python backend Whisper endpoint is not configured.');
    }

    const response = await axios.post(this.whisperTranscribeEndpoint, audioBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });

    return response.data.transcription || 'Could not transcribe audio.';
  }
}

module.exports = {
  VoiceService,
};
