const sqlite3 = require('sqlite3').verbose();
const { escapeRegExp } = require('../utils/text');

class DatabaseService {
  constructor({ dbFile, ramCacheSize }) {
    this.dbFile = dbFile;
    this.ramCacheSize = ramCacheSize;
    this.db = null;
    this.conversationHistory = new Map();
    this.filteredWordsCache = new Map();
  }

  async init() {
    await new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbFile, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.db.serialize(() => {
          this.db.run(
            `CREATE TABLE IF NOT EXISTS messages (
              conversation_id TEXT,
              author TEXT,
              content TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
              type TEXT
            )`,
            (messageTableErr) => {
              if (messageTableErr) {
                reject(messageTableErr);
                return;
              }

              this.db.run(
                `CREATE TABLE IF NOT EXISTS filters (
                  guild_id TEXT,
                  word TEXT,
                  PRIMARY KEY (guild_id, word)
                )`,
                (filtersTableErr) => {
                  if (filtersTableErr) {
                    reject(filtersTableErr);
                    return;
                  }

                  resolve();
                }
              );
            }
          );
        });
      });
    });

    await this.loadAllFilters();
  }

  close() {
    if (!this.db) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  async ensureHistory(conversationId) {
    if (!this.conversationHistory.has(conversationId)) {
      await this.loadRecentHistory(conversationId);
    }
    return this.conversationHistory.get(conversationId);
  }

  addToHistory(conversationId, payload) {
    const history = this.conversationHistory.get(conversationId) || [];
    history.push(payload);
    if (history.length > this.ramCacheSize) {
      history.shift();
    }
    this.conversationHistory.set(conversationId, history);
  }

  saveUserMessage(conversationId, message) {
    return this.run(
      'INSERT INTO messages (conversation_id, author, content, type) VALUES (?, ?, ?, ?)',
      [conversationId, message.author.username, message.content, 'user']
    );
  }

  saveBotMessage(conversationId, message, authorName) {
    return this.run(
      'INSERT INTO messages (conversation_id, author, content, type) VALUES (?, ?, ?, ?)',
      [conversationId, authorName, message.content, 'bot']
    );
  }

  async loadRecentHistory(conversationId) {
    const rows = await this.all(
      'SELECT author, content, type FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?',
      [conversationId, this.ramCacheSize]
    );

    this.conversationHistory.set(conversationId, rows.reverse());
  }

  async loadAllFilters() {
    const rows = await this.all('SELECT guild_id, word FROM filters', []);
    this.filteredWordsCache.clear();

    for (const row of rows) {
      if (!this.filteredWordsCache.has(row.guild_id)) {
        this.filteredWordsCache.set(row.guild_id, new Set());
      }
      this.filteredWordsCache.get(row.guild_id).add(row.word);
    }
  }

  async addFilteredWord(guildId, word) {
    const result = await this.run('INSERT OR IGNORE INTO filters (guild_id, word) VALUES (?, ?)', [guildId, word]);
    if (result.changes > 0) {
      if (!this.filteredWordsCache.has(guildId)) {
        this.filteredWordsCache.set(guildId, new Set());
      }
      this.filteredWordsCache.get(guildId).add(word);
      return true;
    }
    return false;
  }

  async removeFilteredWord(guildId, word) {
    const result = await this.run('DELETE FROM filters WHERE guild_id = ? AND word = ?', [guildId, word]);

    if (result.changes > 0) {
      if (this.filteredWordsCache.has(guildId)) {
        this.filteredWordsCache.get(guildId).delete(word);
        if (this.filteredWordsCache.get(guildId).size === 0) {
          this.filteredWordsCache.delete(guildId);
        }
      }
      return true;
    }

    return false;
  }

  async getFilteredWords(guildId) {
    if (this.filteredWordsCache.has(guildId)) {
      return Array.from(this.filteredWordsCache.get(guildId));
    }

    const rows = await this.all('SELECT word FROM filters WHERE guild_id = ?', [guildId]);
    const words = rows.map((row) => row.word);
    this.filteredWordsCache.set(guildId, new Set(words));
    return words;
  }

  containsFilteredWord(text, guildId) {
    if (!text || typeof text !== 'string') {
      return false;
    }

    const filters = this.filteredWordsCache.get(guildId) || new Set();
    for (const word of filters) {
      const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
      if (regex.test(text)) {
        return true;
      }
    }

    return false;
  }

  run(sql, params) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function runCallback(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this);
      });
    });
  }

  all(sql, params) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }
}

module.exports = {
  DatabaseService,
};
