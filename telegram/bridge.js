import TelegramBot from 'node-telegram-bot-api';
import TelegramCommands from './commands.js';
import config from '../config.js';
import logger from '../core/logger.js';
import { connectDb } from '../utils/db.js';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import mime from 'mime-types';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import stickerPkg from 'wa-sticker-formatter';
const { Sticker, StickerTypes } = stickerPkg;
import qrcode from 'qrcode';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// =============================================================================
// Class
// =============================================================================

class TelegramBridge {

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(whatsappBot) {
        this.whatsappBot = whatsappBot;
        this.telegramBot = null;
        this.commands    = null;

        // In-memory caches (populated from DB on startup)
        this.chatMappings      = new Map(); // jid → topicId
        this.userMappings      = new Map(); // whatsappId → userData
        this.contactMappings   = new Map(); // phone → name
        this.profilePicCache   = new Map(); // jid → url
        this.filters           = new Set(); // blocked words

        // Runtime state
        this.botChatId              = null;
        this.userChatIds            = new Set();
        this.awaitingPassword       = new Set();
        this.activeCallNotifications = new Map();
        this.statusMessageMapping   = new Map();
        this.messageQueue           = new Map();
        this.lastPresenceUpdate     = new Map();
        this.creatingTopics         = new Map(); // jid → Promise (dedup guard)
        this.presenceTimeout        = null;

        // DB collections (assigned in initializeDatabase)
        this.db              = null;
        this.chatMappingsCol = null; // collection: chat_mappings
        this.contactsCol     = null; // collection: contacts
        this.filtersCol      = null; // collection: filters
        this.usersCol        = null; // collection: users
        this.userChatsCol    = null; // collection: user_chats

        this.tempDir = path.join(__dirname, '../temp');
    }

    // =========================================================================
    // AUDIO / WAVEFORM HELPERS
    // =========================================================================

    /**
     * Extract real amplitude waveform from audio file using ffmpeg PCM decode.
     * Returns Uint8Array of `samples` values (0–100).
     * WhatsApp needs this for the animated wave display on PTT messages (Baileys v6.7.9+).
     */
    async generateWaveform(filePath, samples = 64) {
        return new Promise((resolve) => {
            const chunks = [];
            ffmpeg(filePath)
                .setFfmpegPath(ffmpegStatic)
                .audioChannels(1)
                .audioFrequency(8000)
                .format('s16le')          // raw signed 16-bit little-endian PCM
                .on('error', () => {
                    // Fallback: flat mid-range waveform so message still sends
                    resolve(new Uint8Array(samples).fill(50));
                })
                .pipe()
                .on('data', chunk => chunks.push(chunk))
                .on('end', () => {
                    try {
                        const pcm    = Buffer.concat(chunks);
                        const total  = Math.floor(pcm.length / 2); // 16-bit samples
                        const step   = Math.max(1, Math.floor(total / samples));
                        const wave   = new Uint8Array(samples);
                        for (let i = 0; i < samples; i++) {
                            let max = 0;
                            const start = i * step * 2;
                            for (let j = 0; j < step; j++) {
                                const idx = start + j * 2;
                                if (idx + 1 >= pcm.length) break;
                                const val = Math.abs(pcm.readInt16LE(idx));
                                if (val > max) max = val;
                            }
                            wave[i] = Math.min(100, Math.round((max / 32768) * 100));
                        }
                        resolve(wave);
                    } catch {
                        resolve(new Uint8Array(samples).fill(50));
                    }
                });
        });
    }

    /**
     * Get audio duration in seconds via ffprobe.
     * Falls back to 0 — voice note still sends, just without a duration counter.
     */
    async getAudioDuration(filePath) {
        return new Promise((resolve) => {
            ffmpeg.setFfmpegPath(ffmpegStatic);
            ffmpeg(filePath).ffprobe((err, data) => {
                if (err || !data?.format?.duration) return resolve(0);
                resolve(Math.round(data.format.duration));
            });
        });
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    async initialize() {
        const token  = config.get('telegram.botToken');
        const chatId = config.get('telegram.chatId');

        if (!token || token.includes('YOUR_BOT_TOKEN') || !chatId || chatId.includes('YOUR_CHAT_ID')) {
            logger.warn('⚠️ Telegram bot token or chat ID not configured');
            return;
        }

        try {
            await this.initializeDatabase();
            await fs.ensureDir(this.tempDir);

            this.telegramBot = new TelegramBot(token, { polling: true, onlyFirstMatch: true });
            this.commands    = new TelegramCommands(this);

            await this.commands.registerBotCommands();
            await this.setupTelegramHandlers();
            await this.loadMappingsFromDb();
            await this.loadUserChatIds();
            await this.loadFiltersFromDb();

            if (this.whatsappBot?.sock?.user) {
                await this.syncContacts();
            }

            logger.info('✅ Telegram bridge initialized');
        } catch (error) {
    logger.error('❌ Failed to initialize database:', error);
    throw error;
}
    }

 async initializeDatabase() {
    try {
        this.db = await connectDb();
        await this.db.command({ ping: 1 });

        // Dedicated collections per concern
        this.chatMappingsCol = this.db.collection('chat_mappings');
        this.contactsCol     = this.db.collection('contacts');
        this.filtersCol      = this.db.collection('filters');
        this.usersCol        = this.db.collection('users');
        this.userChatsCol    = this.db.collection('user_chats');

        // Indexes
        await this.chatMappingsCol.createIndex({ whatsappJid: 1 }, { unique: true });
        await this.contactsCol.createIndex({ phone: 1 }, { unique: true });
        await this.usersCol.createIndex({ whatsappId: 1 }, { unique: true });
        await this.filtersCol.createIndex({ word: 1 }, { unique: true });
        await this.userChatsCol.createIndex({ chatId: 1 }, { unique: true });

        logger.info('📊 Database initialized (collections: chat_mappings, contacts, filters, users, user_chats)');
    } catch (error) {

        console.error("\n❌ TELEGRAM BRIDGE DATABASE INITIALIZATION FAILED\n");

        console.error("Reason:", error?.message);
        console.error("Name:", error?.name);
        console.error("Code:", error?.code);
        console.error("Stack:", error?.stack);

        if (error?.cause) {
            console.error("Cause:", error.cause);
        }

        if (error?.errorResponse) {
            console.error("Mongo Error Response:", error.errorResponse);
        }

        logger.error({ err: error }, '❌ Failed to initialize database');

        throw error;
    }
}

    // =========================================================================
    // DATABASE — LOAD
    // =========================================================================

    async loadMappingsFromDb() {
        try {
            // Chat mappings
            const chats = await this.chatMappingsCol.find({}).toArray();
            for (const doc of chats) {
                this.chatMappings.set(doc.whatsappJid, doc.telegramTopicId);
                if (doc.profilePicUrl) {
                    this.profilePicCache.set(doc.whatsappJid, doc.profilePicUrl);
                }
            }

            // Users
            const users = await this.usersCol.find({}).toArray();
            for (const doc of users) {
                this.userMappings.set(doc.whatsappId, {
                    name:         doc.name,
                    phone:        doc.phone,
                    firstSeen:    doc.firstSeen,
                    messageCount: doc.messageCount || 0,
                });
            }

            // Contacts
            const contacts = await this.contactsCol.find({}).toArray();
            for (const doc of contacts) {
                this.contactMappings.set(doc.phone, doc.name);
            }

            logger.info(`📊 Loaded — chats: ${this.chatMappings.size}, users: ${this.userMappings.size}, contacts: ${this.contactMappings.size}`);
        } catch (error) {
            logger.error('❌ Failed to load mappings from DB:', error);
        }
    }

    async loadUserChatIds() {
        try {
            const docs = await this.userChatsCol.find({}).toArray();
            this.userChatIds = new Set(docs.map(d => d.chatId));
            logger.info(`✅ Loaded ${this.userChatIds.size} Telegram bot users`);
        } catch (error) {
            logger.error('❌ Failed to load user chat IDs:', error);
        }
    }

    async loadFiltersFromDb() {
        try {
            const docs = await this.filtersCol.find({}).toArray();
            this.filters = new Set(docs.map(d => d.word));
            logger.info(`✅ Loaded ${this.filters.size} filters from DB`);
        } catch (error) {
            logger.error('❌ Failed to load filters from DB:', error);
        }
    }

    // =========================================================================
    // DATABASE — SAVE / UPDATE
    // =========================================================================

    async saveChatMapping(whatsappJid, telegramTopicId, profilePicUrl = null) {
        try {
            const doc = { whatsappJid, telegramTopicId, createdAt: new Date(), lastActivity: new Date() };
            if (profilePicUrl) doc.profilePicUrl = profilePicUrl;

            await this.chatMappingsCol.updateOne(
                { whatsappJid },
                { $set: doc },
                { upsert: true }
            );

            this.chatMappings.set(whatsappJid, telegramTopicId);
            if (profilePicUrl) this.profilePicCache.set(whatsappJid, profilePicUrl);

            logger.debug(`✅ Saved chat mapping: ${whatsappJid} → ${telegramTopicId}`);
        } catch (error) {
            logger.error('❌ Failed to save chat mapping:', error);
        }
    }

    async deleteChatMapping(whatsappJid) {
        this.chatMappings.delete(whatsappJid);
        this.profilePicCache.delete(whatsappJid);
        await this.chatMappingsCol.deleteOne({ whatsappJid });
    }

    async updateProfilePicUrl(whatsappJid, profilePicUrl) {
        try {
            await this.chatMappingsCol.updateOne(
                { whatsappJid },
                { $set: { profilePicUrl, lastProfilePicUpdate: new Date() } }
            );
            this.profilePicCache.set(whatsappJid, profilePicUrl);
        } catch (error) {
            logger.error('❌ Failed to update profile pic URL:', error);
        }
    }

    async saveUserMapping(whatsappId, userData) {
        try {
            await this.usersCol.updateOne(
                { whatsappId },
                {
                    $set: {
                        whatsappId,
                        name:         userData.name,
                        phone:        userData.phone,
                        firstSeen:    userData.firstSeen,
                        messageCount: userData.messageCount || 0,
                        lastSeen:     new Date(),
                    },
                },
                { upsert: true }
            );
            this.userMappings.set(whatsappId, userData);
        } catch (error) {
            logger.error('❌ Failed to save user mapping:', error);
        }
    }

    async saveContactMapping(phone, name) {
        try {
            await this.contactsCol.updateOne(
                { phone },
                { $set: { phone, name, updatedAt: new Date() } },
                { upsert: true }
            );
            this.contactMappings.set(phone, name);
        } catch (error) {
            logger.error('❌ Failed to save contact mapping:', error);
        }
    }

    // =========================================================================
    // DATABASE — FILTERS
    // =========================================================================

    async addFilter(word) {
        this.filters.add(word);
        await this.filtersCol.updateOne(
            { word },
            { $set: { word } },
            { upsert: true }
        );
    }

    async clearFilters() {
        this.filters.clear();
        await this.filtersCol.deleteMany({});
    }

    // =========================================================================
    // CONTACT SYNC
    // =========================================================================

    async syncContacts() {
        try {
            if (!this.whatsappBot?.sock?.user) {
                logger.warn('⚠️ WhatsApp not connected, skipping contact sync');
                return;
            }

            logger.info('📞 Syncing contacts from WhatsApp...');

            const contacts      = this.whatsappBot.sock.store?.contacts || {};
            const contactEntries = Object.entries(contacts);
            let syncedCount     = 0;

            for (const [jid, contact] of contactEntries) {
                if (!jid || jid === 'status@broadcast' || !contact) continue;

                const phone = jid.split('@')[0].split(':')[0];
                const name  = this._resolveContactName(contact, phone);

                if (name && this.contactMappings.get(phone) !== name) {
                    await this.saveContactMapping(phone, name);
                    syncedCount++;
                }
            }

            logger.info(`✅ Synced ${syncedCount} contacts (total: ${this.contactMappings.size})`);
        } catch (error) {
            logger.error('❌ Failed to sync contacts:', error);
        }
    }

    /**
     * Returns a saved/verified contact name, or null.
     * Strictly ignores pushName (notify).
     */
    _resolveContactName(contact, phone) {
        if (contact.name && contact.name !== phone && !contact.name.startsWith('+') && contact.name.trim().length > 0) {
            return contact.name.trim();
        }
        if (contact.verifiedName && contact.verifiedName !== phone && contact.verifiedName.trim().length > 0) {
            return contact.verifiedName.trim();
        }
        return null;
    }

    /**
     * Builds a list of topics whose names differ from saved contact names.
     * Used by the /updatetopics command — does NOT rename automatically.
     * @returns {Array<{jid, topicId, currentName, newName}>}
     */
    async getTopicNameMismatches() {
        const chatId    = config.get('telegram.chatId');
        const mismatches = [];

        for (const [jid, topicId] of this.chatMappings.entries()) {
            // Private chats only
            if (jid.includes('@g.us') || jid.includes('broadcast')) continue;

            const phone     = jid.split('@')[0].split(':')[0];
            const savedName = this.contactMappings.get(phone) || this.contactMappings.get(`+${phone}`);
            if (!savedName) continue;

            // Fetch the current topic name from Telegram
            try {
                const chat = await this.telegramBot.getChat(chatId);
                // We can't get individual topic names from the API directly,
                // so we compare against what we'd name it (savedName) vs the phone fallback
                // The topic was created with either a saved name or +phone, so if savedName
                // exists and the phone is in chatMappings, it's a candidate.
                // We include it as a mismatch unless the topic was already named after savedName.
                // To detect actual renames, we store topicName in the DB.
                const dbDoc = await this.chatMappingsCol.findOne({ whatsappJid: jid });
                const storedName = dbDoc?.topicName || null;

                if (storedName !== savedName) {
                    mismatches.push({
                        jid,
                        topicId,
                        currentName: storedName || `+${phone}`,
                        newName:     savedName,
                    });
                }
            } catch (err) {
                logger.debug(`Could not check topic for ${jid}: ${err.message}`);
            }
        }

        return mismatches;
    }

    /**
     * Renames a single topic and updates the stored name in DB.
     */
    async renameTopicToContactName(jid, topicId, newName) {
        const chatId = config.get('telegram.chatId');
        try {
            await this.telegramBot.editForumTopic(chatId, topicId, { name: newName });
            await this.chatMappingsCol.updateOne({ whatsappJid: jid }, { $set: { topicName: newName } });
            logger.info(`📝 Renamed topic ${topicId} → "${newName}"`);
            return true;
        } catch (err) {
            if (!err.message.includes('not modified')) {
                logger.warn(`⚠️ Failed to rename topic for ${jid}: ${err.message}`);
            }
            return false;
        }
    }

    // =========================================================================
    // TELEGRAM HANDLER SETUP
    // =========================================================================

    async setupTelegramHandlers() {
        this.awaitingPassword = new Set();

        // Main message handler
        this.telegramBot.on('message', this.wrapHandler(async (msg) => {
            const chatType = msg.chat.type;

            // Private DM — password gate + command handler
            if (chatType === 'private') {
                await this._handlePrivateMessage(msg);
                return;
            }

            // Forum topic message
            if ((chatType === 'supergroup' || chatType === 'group') && msg.is_topic_message && msg.message_thread_id) {
                await this.handleTelegramMessage(msg);
                return;
            }

            // Fallback for unexpected thread messages
            if (msg.message_thread_id) {
                logger.warn(`⚠️ Thread message in unexpected context (chatType=${chatType}), attempting to handle`);
                await this.handleTelegramMessage(msg);
            }
        }));

        // Inline button callbacks (used by /updatetopics confirm/cancel)
        this.telegramBot.on('callback_query', this.wrapHandler(async (query) => {
            await this.commands.handleCallbackQuery(query);
        }));

        this.telegramBot.on('polling_error', (error) => logger.error('Telegram polling error:', error));
        this.telegramBot.on('error',         (error) => logger.error('Telegram bot error:', error));

        logger.info('📱 Telegram message handlers set up');
    }

    async _handlePrivateMessage(msg) {
        const chatId      = msg.chat.id;
        const BOT_PASSWORD = config.get('telegram.botPassword');
        const isVerified  = await this.userChatsCol.findOne({ chatId });

        if (!isVerified) {
            if (this.awaitingPassword.has(chatId)) {
                if (msg.text?.trim() === BOT_PASSWORD) {
                    await this.userChatsCol.insertOne({ chatId, firstSeen: new Date() });
                    this.userChatIds.add(chatId);
                    this.botChatId = chatId;
                    this.awaitingPassword.delete(chatId);
                    await this.telegramBot.sendMessage(chatId, '✅ Access granted! You can now use the bot.');
                    logger.info(`🔓 Telegram bot access granted: ${chatId}`);
                } else {
                    await this.telegramBot.sendMessage(chatId, '❌ Incorrect password. Try again:');
                }
            } else {
                this.awaitingPassword.add(chatId);
                await this.telegramBot.sendMessage(chatId, '🔐 This bot is password-protected.\nPlease enter the password to continue:');
            }
            return;
        }

        this.userChatIds.add(chatId);
        this.botChatId = chatId;
        await this.commands.handleCommand(msg);
    }

    wrapHandler(handler) {
        return async (...args) => {
            try {
                await handler(...args);
            } catch (error) {
                logger.error('❌ Unhandled error in Telegram handler:', error);
            }
        };
    }

    // =========================================================================
    // MESSAGING — HELPERS
    // =========================================================================

    async logToTelegram(title, message) {
        if (!this.telegramBot) return;
        const logChannel = config.get('telegram.logChannel');
        if (!logChannel || logChannel.includes('YOUR_LOG_CHANNEL')) return;

        try {
            await this.telegramBot.sendMessage(
                logChannel,
                `🤖 *${title}*\n\n${message}\n\n⏰ ${new Date().toLocaleString()}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            logger.debug('Could not send log to Telegram:', error.message);
        }
    }

    async sendToAllUsers(text, extra = {}) {
        for (const chatId of this.userChatIds) {
            try {
                await this.telegramBot.sendMessage(chatId, text, extra);
            } catch (err) {
                logger.warn(`⚠️ Failed to send message to user ${chatId}: ${err.message}`);
            }
        }
    }

    async setReaction(chatId, messageId, emoji) {
        try {
            const token = config.get('telegram.botToken');
            await axios.post(`https://api.telegram.org/bot${token}/setMessageReaction`, {
                chat_id:   chatId,
                message_id: messageId,
                reaction:  [{ type: 'emoji', emoji }],
            });
        } catch (err) {
            logger.debug('Failed to set reaction:', err?.response?.data?.description || err.message);
        }
    }

    // =========================================================================
    // MESSAGING — QR & STARTUP
    // =========================================================================

    async sendQRCode(qrData) {
        if (!this.telegramBot) return;

        const qrImagePath = path.join(this.tempDir, `qr_${Date.now()}.png`);
        await qrcode.toFile(qrImagePath, qrData, {
            width: 512, margin: 2,
            color: { dark: '#000000', light: '#FFFFFF' },
        });

        const caption = '📱 *WhatsApp QR Code*\n\n' +
            '🔄 Scan this QR code with WhatsApp to connect\n' +
            '⏰ QR code expires in 30 seconds\n\n' +
            '💡 Open WhatsApp → Settings → Linked Devices → Link a Device';

        const opts = { caption, parse_mode: 'Markdown' };

        for (const chatId of this.userChatIds) {
            try {
                await this.telegramBot.sendPhoto(chatId, qrImagePath, opts);
            } catch (err) {
                logger.warn(`⚠️ Failed to send QR to ${chatId}: ${err.message}`);
            }
        }

        const logChannel = config.get('telegram.logChannel');
        if (logChannel && !logChannel.includes('YOUR_LOG_CHANNEL')) {
            try {
                await this.telegramBot.sendPhoto(logChannel, qrImagePath, opts);
            } catch (err) {
                logger.warn(`⚠️ Failed to send QR to log channel: ${err.message}`);
            }
        }

        setTimeout(() => fs.remove(qrImagePath).catch(() => {}), 60_000);
        logger.info(`✅ Sent QR code to ${this.userChatIds.size} users`);
    }

    async sendStartMessage() {
        const msg = `🚀 *HyperWa Bridge Started!*\n\n` +
            `✅ WhatsApp: Connected\n` +
            `✅ Telegram Bridge: Active\n` +
            `📞 Contacts: ${this.contactMappings.size} synced\n` +
            `💬 Chats: ${this.chatMappings.size} mapped\n`;

        await this.sendToAllUsers(msg, { parse_mode: 'Markdown' });

        const logChannel = config.get('telegram.logChannel');
        if (logChannel && !logChannel.includes('YOUR_LOG_CHANNEL')) {
            try {
                await this.telegramBot.sendMessage(logChannel, msg, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error('❌ Failed to send start message to log channel:', err);
            }
        }
    }

    // =========================================================================
    // MESSAGING — PRESENCE
    // =========================================================================

    async sendPresence(jid, presenceType = 'available') {
        try {
            if (!this.whatsappBot?.sock) return;

            // Online presence (available/unavailable) and typing presence (composing/paused)
            // are controlled by separate config flags.
            const isTyping = presenceType === 'composing' || presenceType === 'paused';
            const featureKey = isTyping ? 'telegram.features.typingPresence' : 'telegram.features.onlinePresence';
            if (!config.get(featureKey)) return;

            const now        = Date.now();
            const lastUpdate = this.lastPresenceUpdate.get(jid) || 0;
            if (now - lastUpdate < 1000) return;

            this.lastPresenceUpdate.set(jid, now);
            await this.whatsappBot.sock.sendPresenceUpdate(presenceType, jid);
        } catch (error) {
            logger.debug('Failed to send presence:', error);
        }
    }

    async sendTypingPresence(jid) {
        try {
            if (!this.whatsappBot?.sock || !config.get('telegram.features.typingPresence')) return;

            await this.sendPresence(jid, 'composing');

            if (this.presenceTimeout) clearTimeout(this.presenceTimeout);
            this.presenceTimeout = setTimeout(async () => {
                try { await this.sendPresence(jid, 'paused'); } catch {}
            }, 3000);
        } catch (error) {
            logger.debug('Failed to send typing presence:', error);
        }
    }

    // =========================================================================
    // WHATSAPP → TELEGRAM: MESSAGE SYNC
    // =========================================================================

   async syncMessage(whatsappMsg, text) {
    if (!this.telegramBot || !config.get('telegram.enabled')) return;

    let sender = await this.resolveToPN(whatsappMsg.key.remoteJid);
    const isFromMe = whatsappMsg.key.fromMe;

    // --- Config-Based Sync Control ---
    const isGroup = sender.endsWith('@g.us');
    const isNewsletter = sender.endsWith('@newsletter');
    const isPrivate = !isGroup && !isNewsletter && sender !== 'status@broadcast';

    // Early return if the specific chat type is disabled in config
    if (isPrivate && config.get('telegram.features.syncPrivate') === false) return;
    if (isGroup && config.get('telegram.features.syncGroups') === false) return;
    if (isNewsletter && config.get('telegram.features.syncNewsletters') === false) return;
    // ---------------------------------

    logger.info(`📩 [SYNC] sender=${sender} participant=${isFromMe ? 'me' : 'other'}`);

    // Status messages
    if (sender === 'status@broadcast') {
        await this.handleStatusMessage(whatsappMsg, text);
        return;
    }

    // Outgoing (sent by you on another device)
    if (isFromMe) {
        const topicId = this.chatMappings.get(sender);
        if (topicId) await this.syncOutgoingMessage(whatsappMsg, text, topicId, sender);
        return;
    }

    let participant = await this.resolveToPN(whatsappMsg.key.participant || sender);
    await this.createUserMapping(participant, whatsappMsg);

    const topicId = await this.getOrCreateTopic(sender, whatsappMsg);
    if (!topicId) return;

    // Media dispatch
    const msg = whatsappMsg.message;

    if      (msg?.ptvMessage || msg?.videoMessage?.ptv) await this.handleWhatsAppMedia(whatsappMsg, 'video_note', topicId);
    else if (msg?.imageMessage)                          await this.handleWhatsAppMedia(whatsappMsg, 'image',      topicId);
    else if (msg?.videoMessage)                          await this.handleWhatsAppMedia(whatsappMsg, 'video',      topicId);
    else if (msg?.audioMessage)                          await this.handleWhatsAppMedia(whatsappMsg, 'audio',      topicId);
    else if (msg?.documentMessage)                       await this.handleWhatsAppMedia(whatsappMsg, 'document',   topicId);
    else if (msg?.stickerMessage)                        await this.handleWhatsAppMedia(whatsappMsg, 'sticker',    topicId);
    else if (msg?.locationMessage)                       await this.handleWhatsAppLocation(whatsappMsg, topicId);
    else if (msg?.contactMessage)                        await this.handleWhatsAppContact(whatsappMsg, topicId);
    else if (text) {
        let messageText = text;

        // Prefix sender name inside groups / newsletters
        if ((isGroup || isNewsletter) && participant !== sender) {
            const senderPhone = participant.split('@')[0].split(':')[0];
            const senderName  = this.contactMappings.get(senderPhone) ||
                                this.contactMappings.get(`+${senderPhone}`) ||
                                whatsappMsg.pushName ||
                                senderPhone;
            messageText = `👤 ${senderName}:\n${text}`;
        }

        await this.sendSimpleMessage(topicId, messageText, sender);
    }

    // Queue read receipt
    if (whatsappMsg.key?.id && config.get('telegram.features.readReceipts') !== false) {
        this.queueMessageForReadReceipt(sender, whatsappMsg.key);
    }
}

    async syncOutgoingMessage(whatsappMsg, text, topicId, sender) {
        if (!config.get('telegram.features.sendOutgoingMessages')) return;
        try {
            const msg = whatsappMsg.message;

            if      (msg?.ptvMessage || msg?.videoMessage?.ptv) await this.handleWhatsAppMedia(whatsappMsg, 'video_note', topicId, true);
            else if (msg?.imageMessage)                          await this.handleWhatsAppMedia(whatsappMsg, 'image',      topicId, true);
            else if (msg?.videoMessage)                          await this.handleWhatsAppMedia(whatsappMsg, 'video',      topicId, true);
            else if (msg?.audioMessage)                          await this.handleWhatsAppMedia(whatsappMsg, 'audio',      topicId, true);
            else if (msg?.documentMessage)                       await this.handleWhatsAppMedia(whatsappMsg, 'document',   topicId, true);
            else if (msg?.stickerMessage)                        await this.handleWhatsAppMedia(whatsappMsg, 'sticker',    topicId, true);
            else if (msg?.locationMessage)                       await this.handleWhatsAppLocation(whatsappMsg, topicId, true);
            else if (msg?.contactMessage)                        await this.handleWhatsAppContact(whatsappMsg, topicId, true);
            else if (text)                                       await this.sendSimpleMessage(topicId, `📤 You: ${text}`, sender);
        } catch (error) {
            logger.error('❌ Failed to sync outgoing message:', error);
        }
    }

    // =========================================================================
    // WHATSAPP → TELEGRAM: STATUS
    // =========================================================================

    async handleStatusMessage(whatsappMsg, text) {
        try {
            if (!config.get('telegram.features.statusSync')) return;

            const participant    = whatsappMsg.key.participant;
            const resolvedJid   = await this.resolveToPN(participant);
            const phone         = this.normalizePhone(resolvedJid);
            const contactName   = this.contactMappings.get(phone) || `+${phone}`;
            const topicId     = await this.getOrCreateTopic('status@broadcast', whatsappMsg);
            if (!topicId) return;

            const chatId    = config.get('telegram.chatId');
            const mediaType = this.getMediaType(whatsappMsg);

            let sentMsg;

            if (mediaType && mediaType !== 'text') {
                const caption = text
                    ? `💭 "_${text}_"\n\n📱 *${contactName}* (+${phone})`
                    : `📱 *${contactName}* (+${phone})`;
                sentMsg = await this.forwardStatusMedia(whatsappMsg, topicId, caption, mediaType);
            } else {
                const statusMessage = text
                    ? `💭 "_${text}_"\n\n📱 *${contactName}* (+${phone})`
                    : `📱 *${contactName}* (+${phone})`;
                sentMsg = await this.telegramBot.sendMessage(chatId, statusMessage, {
                    message_thread_id: topicId,
                    parse_mode: 'Markdown',
                });
            }

            if (sentMsg) this.statusMessageMapping.set(sentMsg.message_id, whatsappMsg.key);

            if (config.get('features.autoViewStatus') && this.whatsappBot.sock?.ws?.readyState === 1) {
                try {
                    await this.whatsappBot.sock.readMessages([whatsappMsg.key]);
                } catch (err) {
                    logger.warn('⚠️ Could not mark status as read:', err.message);
                }
            }
        } catch (error) {
            logger.error('❌ Error handling status message:', error);
            if (error.message?.includes('Connection Closed') || error.output?.statusCode === 428) {
                logger.warn('⚠️ WhatsApp connection lost, skipping status sync');
            }
        }
    }

    async forwardStatusMedia(whatsappMsg, topicId, caption, mediaType) {
        try {
            const stream = await downloadContentFromMessage(
                whatsappMsg.message[`${mediaType}Message`],
                mediaType
            );
            const buffer = await this.streamToBuffer(stream);
            const chatId = config.get('telegram.chatId');
            const opts   = { message_thread_id: topicId, caption, parse_mode: 'Markdown' };

            switch (mediaType) {
                case 'image':    return await this.telegramBot.sendPhoto(chatId,    buffer, opts);
                case 'video':    return await this.telegramBot.sendVideo(chatId,    buffer, opts);
                case 'audio':    return await this.telegramBot.sendAudio(chatId,    buffer, opts);
                case 'document': return await this.telegramBot.sendDocument(chatId, buffer, opts);
                case 'sticker': {
                    const sent = await this.telegramBot.sendSticker(chatId, buffer, { message_thread_id: topicId });
                    if (caption) await this.telegramBot.sendMessage(chatId, caption, { message_thread_id: topicId, parse_mode: 'Markdown' });
                    return sent;
                }
                default: return await this.telegramBot.sendDocument(chatId, buffer, opts);
            }
        } catch (error) {
            logger.error('❌ Error forwarding status media:', error);
            try {
                return await this.telegramBot.sendMessage(
                    config.get('telegram.chatId'),
                    `${caption}\n\n⚠️ _Media could not be forwarded_`,
                    { message_thread_id: topicId, parse_mode: 'Markdown' }
                );
            } catch (fallbackErr) {
                logger.error('❌ Fallback message also failed:', fallbackErr);
                return null;
            }
        }
    }

    getMediaType(msg) {
        if (msg.message?.imageMessage)    return 'image';
        if (msg.message?.videoMessage)    return 'video';
        if (msg.message?.audioMessage)    return 'audio';
        if (msg.message?.documentMessage) return 'document';
        if (msg.message?.stickerMessage)  return 'sticker';
        if (msg.message?.locationMessage) return 'location';
        if (msg.message?.contactMessage)  return 'contact';
        return 'text';
    }

    // =========================================================================
    // WHATSAPP → TELEGRAM: MEDIA
    // =========================================================================

    async handleWhatsAppMedia(whatsappMsg, mediaType, topicId, isOutgoing = false) {
        const send = async (finalTopicId) => {
            try {
                const msg      = whatsappMsg.message;
                const sender   = whatsappMsg.key.remoteJid;
                let caption    = this.extractText(whatsappMsg);
                let mediaMessage;
                let fileName   = `media_${Date.now()}`;

                switch (mediaType) {
                    case 'image':      mediaMessage = msg.imageMessage;    fileName += '.jpg';  break;
                    case 'video':      mediaMessage = msg.videoMessage;    fileName += '.mp4';  break;
                    case 'video_note': mediaMessage = msg.ptvMessage || msg.videoMessage; fileName += '.mp4'; break;
                    case 'audio':      mediaMessage = msg.audioMessage;    fileName += '.ogg';  break;
                    case 'document':   mediaMessage = msg.documentMessage; fileName = mediaMessage.fileName || `document_${Date.now()}`; break;
                    case 'sticker':    mediaMessage = msg.stickerMessage;  fileName += '.webp'; break;
                }

                if (!mediaMessage) return logger.error(`❌ No media content for ${mediaType}`);

                const stream   = await downloadContentFromMessage(mediaMessage, mediaType === 'video_note' ? 'video' : mediaType);
                const buffer   = await this.streamToBuffer(stream);
                if (!buffer?.length) return logger.error(`❌ Empty buffer for ${mediaType}`);

                const filePath = path.join(this.tempDir, fileName);
                await fs.writeFile(filePath, buffer);

                const chatId = config.get('telegram.chatId');

                if (isOutgoing) {
                    caption = caption ? `📤 You: ${caption}` : '📤 You sent media';
                } else if (sender.endsWith('@g.us') && whatsappMsg.key.participant !== sender) {
                    const senderPhone = whatsappMsg.key.participant.split('@')[0];
                    const senderName  = this.contactMappings.get(senderPhone) || senderPhone;
                    caption = `👤 ${senderName}:\n${caption || ''}`;
                }

                const opts = { caption, message_thread_id: finalTopicId };

                switch (mediaType) {
                    case 'image':
                        await this.telegramBot.sendPhoto(chatId, filePath, opts);
                        break;
                    case 'video':
                        mediaMessage.gifPlayback
                            ? await this.telegramBot.sendAnimation(chatId, filePath, opts)
                            : await this.telegramBot.sendVideo(chatId, filePath, opts);
                        break;
                    case 'video_note': {
                        const notePath = await this.convertToVideoNote(filePath);
                        await this.telegramBot.sendVideoNote(chatId, notePath, { message_thread_id: finalTopicId });
                        if (notePath !== filePath) await fs.unlink(notePath).catch(() => {});
                        break;
                    }
                    case 'audio':
                        mediaMessage.ptt
                            ? await this.telegramBot.sendVoice(chatId, filePath, opts)
                            : await this.telegramBot.sendAudio(chatId, filePath, { ...opts, title: mediaMessage.title || 'Audio' });
                        break;
                    case 'document':
                        await this.telegramBot.sendDocument(chatId, filePath, opts);
                        break;
                    case 'sticker':
                        try {
                            await this.telegramBot.sendSticker(chatId, filePath, { message_thread_id: finalTopicId });
                        } catch {
                            const pngPath = filePath.replace('.webp', '.png');
                            await sharp(filePath).png().toFile(pngPath);
                            await this.telegramBot.sendPhoto(chatId, pngPath, { caption: caption || 'Sticker', message_thread_id: finalTopicId });
                            await fs.unlink(pngPath).catch(() => {});
                        }
                        break;
                }

                await fs.unlink(filePath).catch(() => {});
                logger.info(`✅ ${mediaType} sent to topic ${finalTopicId}`);

            } catch (error) {
                const desc = error.response?.data?.description || error.message;
                if (desc.includes('message thread not found')) {
                    logger.warn(`🗑️ Topic ${topicId} deleted, recreating and retrying…`);
                    const sender = whatsappMsg.key.remoteJid;
                    await this.deleteChatMapping(sender);
                    const newTopicId = await this.getOrCreateTopic(sender, whatsappMsg);
                    if (newTopicId) await send(newTopicId);
                } else {
                    logger.error(`❌ Failed to send ${mediaType}: ${desc}`);
                }
            }
        };

        await send(topicId);
    }

    async handleWhatsAppLocation(whatsappMsg, topicId, isOutgoing = false) {
        const loc    = whatsappMsg.message.locationMessage;
        const sender = whatsappMsg.key.remoteJid;
        const chatId = config.get('telegram.chatId');

        const sendLocation = async (tId) => {
            await this.telegramBot.sendLocation(chatId, loc.degreesLatitude, loc.degreesLongitude, { message_thread_id: tId });
            if (isOutgoing) await this.telegramBot.sendMessage(chatId, '📤 You shared location', { message_thread_id: tId });
        };

        try {
            await sendLocation(topicId);
        } catch (error) {
            const desc = error.response?.data?.description || error.message;
            if (desc.includes('message thread not found')) {
                logger.warn(`🗑️ Location topic deleted, recreating…`);
                await this.deleteChatMapping(sender);
                const newTopicId = await this.getOrCreateTopic(sender, whatsappMsg);
                if (newTopicId) await sendLocation(newTopicId);
            } else {
                logger.error('❌ Failed to send location:', desc);
            }
        }
    }

    async handleWhatsAppContact(whatsappMsg, topicId, isOutgoing = false) {
        const contactMsg  = whatsappMsg.message.contactMessage;
        const displayName = contactMsg.displayName || 'Unknown Contact';
        const phoneNumber = contactMsg.vcard.match(/TEL.*:(.*)/)?.[1] || '';
        const sender      = whatsappMsg.key.remoteJid;
        const chatId      = config.get('telegram.chatId');

        const sendContact = async (tId) => {
            await this.telegramBot.sendContact(chatId, phoneNumber, displayName, { message_thread_id: tId });
        };

        try {
            await sendContact(topicId);
        } catch (error) {
            const desc = error.response?.data?.description || error.message;
            if (desc.includes('message thread not found')) {
                logger.warn(`🗑️ Contact topic deleted, recreating…`);
                await this.deleteChatMapping(sender);
                const newTopicId = await this.getOrCreateTopic(sender, whatsappMsg);
                if (newTopicId) await sendContact(newTopicId);
            } else {
                logger.error('❌ Failed to send contact:', desc);
            }
        }
    }

    // =========================================================================
    // WHATSAPP → TELEGRAM: PROFILE PICTURE
    // =========================================================================

    async sendWelcomeMessage(topicId, jid, isGroup, whatsappMsg, initialProfilePicUrl = null) {
        try {
            const chatId      = config.get('telegram.chatId');
            const phone       = jid.split('@')[0];
            const contactName = this.contactMappings.get(phone) || `+${phone}`;
            const participant = whatsappMsg.key.participant || jid;
            const userInfo    = this.userMappings.get(participant);
            const handleName  = whatsappMsg.pushName || userInfo?.name || 'Unknown';

            let welcomeText;

            if (isGroup) {
                try {
                    const meta = await this.whatsappBot.sock.groupMetadata(jid);
                    welcomeText = `🏷️ **Group Information**\n\n` +
                        `📝 **Name:** ${meta.subject}\n` +
                        `👥 **Participants:** ${meta.participants.length}\n` +
                        `🆔 **Group ID:** \`${jid}\`\n` +
                        `📅 **Created:** ${new Date(meta.creation * 1000).toLocaleDateString()}\n\n` +
                        `💬 Messages from this group will appear here`;
                } catch {
                    welcomeText = `🏷️ **Group Chat**\n\n💬 Messages from this group will appear here`;
                }
            } else {
                let userStatus = '';
                try {
                    const status = await this.whatsappBot.sock.fetchStatus(jid);
                    if (status?.status) userStatus = `📝 **Status:** ${status.status}\n`;
                } catch {}

                welcomeText = `👤 **Contact Information**\n\n` +
                    `📝 **Name:** ${contactName}\n` +
                    `📱 **Phone:** +${phone}\n` +
                    `🖐️ **Handle:** ${handleName}\n` +
                    userStatus +
                    `🆔 **WhatsApp ID:** \`${jid}\`\n` +
                    `📅 **First Contact:** ${new Date().toLocaleDateString()}\n\n` +
                    `💬 Messages with this contact will appear here`;
            }

            const sent = await this.telegramBot.sendMessage(chatId, welcomeText, {
                message_thread_id: topicId,
                parse_mode: 'Markdown',
            });
            await this.telegramBot.pinChatMessage(chatId, sent.message_id);

            if (initialProfilePicUrl) {
                await this.sendProfilePictureWithUrl(topicId, jid, initialProfilePicUrl, false);
            }
        } catch (error) {
            logger.error('❌ Failed to send welcome message:', error);
        }
    }

    async sendProfilePicture(topicId, jid, isUpdate = false) {
        try {
            if (!config.get('telegram.features.profilePicSync')) return;

            let currentUrl = null;
            try {
                currentUrl = await this.whatsappBot.sock.profilePictureUrl(jid, 'image');
            } catch {}

            if (!currentUrl) return;

            const dbDoc     = await this.chatMappingsCol.findOne({ whatsappJid: jid });
            const storedUrl = dbDoc?.profilePicUrl || null;
            if (currentUrl === storedUrl) {
                this.profilePicCache.set(jid, currentUrl);
                return;
            }

            await this.telegramBot.sendPhoto(config.get('telegram.chatId'), currentUrl, {
                message_thread_id: topicId,
                caption: isUpdate ? '📸 Profile picture updated' : '📸 Profile Picture',
            });

            await this.updateProfilePicUrl(jid, currentUrl);
        } catch (error) {
            logger.error(`📸 ❌ Could not send profile picture for ${jid}:`, error);
        }
    }

    async sendProfilePictureWithUrl(topicId, jid, profilePicUrl, isUpdate = false) {
        try {
            if (!config.get('telegram.features.profilePicSync') || !profilePicUrl) return;

            await this.telegramBot.sendPhoto(config.get('telegram.chatId'), profilePicUrl, {
                message_thread_id: topicId,
                caption: isUpdate ? '📸 Profile picture updated' : '📸 Profile Picture',
            });

            await this.updateProfilePicUrl(jid, profilePicUrl);
        } catch (error) {
            logger.error(`📸 ❌ Could not send profile picture with URL for ${jid}:`, error);
        }
    }

    // =========================================================================
    // TOPIC MANAGEMENT
    // =========================================================================

    async getOrCreateTopic(chatJid, whatsappMsg) {
        chatJid = await this.resolveToPN(chatJid);
        const chatId = config.get('telegram.chatId');
        if (!chatId) return null;

        // If mapping exists, verify the topic is still alive
        if (this.chatMappings.has(chatJid)) {
            const existingTopicId = this.chatMappings.get(chatJid);
            try {
                await this.telegramBot.editForumTopic(chatId, existingTopicId, {});
                return existingTopicId;
            } catch (err) {
                const desc = err.response?.data?.description || err.message;
                if (desc.includes('message thread not found')) {
                    logger.warn(`🗑️ Topic ${existingTopicId} deleted, cleaning mapping for ${chatJid}`);
                    await this.deleteChatMapping(chatJid);
                } else {
                    return existingTopicId;
                }
            }
        }

        // Deduplicate concurrent creation for the same JID
        if (this.creatingTopics.has(chatJid)) {
            return await this.creatingTopics.get(chatJid);
        }

        const creationPromise = (async () => {
            try {
                const isGroup      = chatJid.endsWith('@g.us');
                const isNewsletter = chatJid.endsWith('@newsletter');
                const isStatus     = chatJid === 'status@broadcast';
                const isCall       = chatJid === 'call@broadcast';

                let topicName = 'Unknown Chat';
                let iconColor = 0x7ABA3C;

                if (isGroup) {
                    try {
                        const meta = await this.whatsappBot.sock.groupMetadata(chatJid);
                        topicName = meta.subject || 'Unknown Group';
                    } catch { topicName = 'Group Chat'; }
                    iconColor = 0x6FB9F0;
                } else if (isNewsletter) {
                    try {
                        const meta = await this.whatsappBot.sock.newsletterMetadata('jid', chatJid);
                        topicName = meta?.name || 'WhatsApp Channel';
                    } catch { topicName = 'WhatsApp Channel'; }
                    iconColor = 0xFFD700;
                } else if (isStatus) {
                    topicName = '📊 Status Updates';
                    iconColor  = 0xFF6B35;
                } else if (isCall) {
                    topicName = '📞 Call Logs';
                    iconColor  = 0xFF4757;
                } else {
                    const phone   = chatJid.split('@')[0].split(':')[0];
                    topicName     = this.contactMappings.get(phone) || `+${phone}`;
                }

                const topic = await this.telegramBot.createForumTopic(chatId, topicName, { icon_color: iconColor });
                await this.saveChatMapping(chatJid, topic.message_thread_id);
                // Store the name we created the topic with
                await this.chatMappingsCol.updateOne({ whatsappJid: chatJid }, { $set: { topicName } });

                logger.info(`♻️ Created topic ${topic.message_thread_id} for ${chatJid} ("${topicName}")`);
                return topic.message_thread_id;
            } catch (err) {
                logger.error(`❌ Failed to create topic for ${chatJid}:`, err);
                return null;
            } finally {
                this.creatingTopics.delete(chatJid);
            }
        })();

        this.creatingTopics.set(chatJid, creationPromise);
        return await creationPromise;
    }

    // =========================================================================
    // TELEGRAM → WHATSAPP: INCOMING MESSAGES
    // =========================================================================

    async handleTelegramMessage(msg) {
        try {
            const topicId    = msg.message_thread_id;
            const whatsappJid = this.findWhatsAppJidByTopic(topicId);

            if (!whatsappJid) {
                logger.warn('⚠️ Could not find WhatsApp chat for Telegram message');
                return;
            }

            const sock = this.whatsappBot?.sock;
            if (!sock?.user?.id) {
                logger.error('❌ WhatsApp socket not ready');
                return;
            }

            await this.sendTypingPresence(whatsappJid);

            // Status reply
            if (whatsappJid === 'status@broadcast' && msg.reply_to_message) {
                await this.handleStatusReply(msg);
                return;
            }

            // Media routing
            if (msg.photo)      return await this.handleTelegramMedia(msg, 'photo');
            if (msg.video)      return await this.handleTelegramMedia(msg, 'video');
            if (msg.animation)  return await this.handleTelegramMedia(msg, 'animation');
            if (msg.video_note) return await this.handleTelegramMedia(msg, 'video_note');
            if (msg.voice)      return await this.handleTelegramMedia(msg, 'voice');
            if (msg.audio)      return await this.handleTelegramMedia(msg, 'audio');
            if (msg.document)   return await this.handleTelegramMedia(msg, 'document');
            if (msg.sticker)    return await this.handleTelegramMedia(msg, 'sticker');
            if (msg.location)   return await this.handleTelegramLocation(msg);
            if (msg.contact)    return await this.handleTelegramContact(msg);

            // Text
            if (msg.text) {
                const originalText = msg.text.trim();
                const textLower    = originalText.toLowerCase();

                // Filter check
                for (const word of this.filters) {
                    if (textLower.startsWith(word)) {
                        logger.info(`🛑 Blocked message due to filter "${word}"`);
                        await this.setReaction(msg.chat.id, msg.message_id, '🚫');
                        return;
                    }
                }

                const messageOptions = { text: originalText };
                if (msg.entities?.some(e => e.type === 'spoiler')) {
                    messageOptions.text = `🫥 ${originalText}`;
                }

                const jid        = this._normalizeJidForSend(whatsappJid);
                const sendResult = await sock.sendMessage(jid, messageOptions);

                await new Promise(r => setTimeout(r, 300));
                await this.sendPresence(jid, 'available');

                if (sendResult?.key?.id) {
                    await this.setReaction(msg.chat.id, msg.message_id, '👍');
                    if (config.get('telegram.features.readReceipts')) {
                        setTimeout(async () => { try { await sock.readMessages([sendResult.key]); } catch {} }, 1000);
                    }
                } else {
                    throw new Error('Message sent but no confirmation key');
                }
            }

            setTimeout(async () => { await this.sendPresence(whatsappJid, 'available'); }, 2000);

        } catch (error) {
            logger.error('❌ Failed to handle Telegram message:', error);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleStatusReply(msg) {
        let contactName = 'Unknown';
        try {
            if (!msg.reply_to_message) return;

            const originalStatusKey = this.statusMessageMapping.get(msg.reply_to_message.message_id);
            if (!originalStatusKey) {
                await this.telegramBot.sendMessage(msg.chat.id, '❌ Cannot find original status to reply to', { message_thread_id: msg.message_thread_id });
                return;
            }

            const sock = this.whatsappBot?.sock;
            if (!sock?.user?.id) {
                logger.error('❌ WhatsApp socket not ready');
                return;
            }

            const statusJid = originalStatusKey.participant;
            const phone     = statusJid.split('@')[0].split(':')[0];
            contactName     = this.contactMappings.get(phone) || `+${phone}`;

            const jid = statusJid.endsWith('@s.whatsapp.net') ? statusJid : `${phone}@s.whatsapp.net`;

            const sendResult = await sock.sendMessage(jid, {
                text: msg.text,
                contextInfo: {
                    stanzaId:    originalStatusKey.id,
                    participant: originalStatusKey.participant,
                    remoteJid:   'status@broadcast',
                },
            });

            if (sendResult?.key?.id) {
                await this.telegramBot.sendMessage(msg.chat.id, `✅ Status reply sent to ${contactName}`, { message_thread_id: msg.message_thread_id });
                await this.setReaction(msg.chat.id, msg.message_id, '✅');
            } else {
                throw new Error('Failed to send status reply');
            }
        } catch (error) {
            logger.error('❌ Failed to handle status reply:', error);
            await this.telegramBot.sendMessage(msg.chat.id, `❌ Failed to send reply to ${contactName}`, { message_thread_id: msg.message_thread_id });
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramMedia(msg, mediaType) {
        try {
            const topicId    = msg.message_thread_id;
            const whatsappJid = this.findWhatsAppJidByTopic(topicId);
            if (!whatsappJid) return logger.warn('⚠️ Could not find WhatsApp chat for Telegram media');

            const sock = this.whatsappBot?.sock;
            if (!sock?.user?.id) return logger.error('❌ WhatsApp socket not ready');

            await this.sendPresence(whatsappJid, 'composing');

            if (mediaType === 'sticker') return await this.handleTelegramSticker(msg);

            let fileId, fileName;
            const caption = msg.caption || '';

            switch (mediaType) {
                case 'photo':      fileId = msg.photo[msg.photo.length - 1].file_id; fileName = `photo_${Date.now()}.jpg`;       break;
                case 'video':      fileId = msg.video.file_id;      fileName = `video_${Date.now()}.mp4`;                        break;
                case 'animation':  fileId = msg.animation.file_id;  fileName = `animation_${Date.now()}.mp4`;                   break;
                case 'video_note': fileId = msg.video_note.file_id; fileName = `video_note_${Date.now()}.mp4`;                  break;
                case 'voice':      fileId = msg.voice.file_id;      fileName = `voice_${Date.now()}.ogg`;                       break;
                case 'audio':      fileId = msg.audio.file_id;      fileName = msg.audio.file_name || `audio_${Date.now()}.mp3`; break;
                case 'document':   fileId = msg.document.file_id;   fileName = msg.document.file_name || `doc_${Date.now()}`;   break;
            }

            const fileLink = await this.telegramBot.getFileLink(fileId);
            const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
            const buffer   = Buffer.from(response.data);
            const filePath = path.join(this.tempDir, fileName);
            await fs.writeFile(filePath, buffer);

            const hasMediaSpoiler = msg.has_media_spoiler || msg.caption_entities?.some(e => e.type === 'spoiler');

            let messageOptions = {};
            switch (mediaType) {
                case 'photo':      messageOptions = { image: fs.readFileSync(filePath),  caption, viewOnce: hasMediaSpoiler }; break;
                case 'video':      messageOptions = { video: fs.readFileSync(filePath),  caption, viewOnce: hasMediaSpoiler }; break;
                case 'video_note': messageOptions = { video: fs.readFileSync(filePath),  ptv: true };                          break;
                case 'animation':  messageOptions = { video: fs.readFileSync(filePath),  gifPlayback: true, caption };         break;
                case 'voice': {
                    const audioBuffer = fs.readFileSync(filePath);
                    const [waveform, seconds] = await Promise.all([
                        this.generateWaveform(filePath),
                        this.getAudioDuration(filePath),
                    ]);
                    logger.info(`🎤 Voice → duration: ${seconds}s, waveform peak: ${Math.max(...waveform)}`);
                    messageOptions = { audio: audioBuffer, ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds, waveform };
                    break;
                }
                case 'audio':      messageOptions = { audio: fs.readFileSync(filePath),  mimetype: mime.lookup(fileName) || 'audio/mp3', fileName, caption }; break;
                case 'document':   messageOptions = { document: fs.readFileSync(filePath), fileName, mimetype: mime.lookup(fileName) || 'application/octet-stream', caption }; break;
            }

            const jid        = this._normalizeJidForSend(whatsappJid);
            const sendResult = await sock.sendMessage(jid, messageOptions);
            await fs.unlink(filePath).catch(() => {});

            await new Promise(r => setTimeout(r, 300));
            await this.sendPresence(jid, 'available');

            if (sendResult?.key?.id) {
                await this.setReaction(msg.chat.id, msg.message_id, '👍');
                if (config.get('telegram.features.readReceipts')) {
                    setTimeout(async () => { try { await sock.readMessages([sendResult.key]); } catch {} }, 1000);
                }
            } else {
                throw new Error('Media sent but no confirmation key');
            }
        } catch (error) {
            logger.error(`❌ Failed to handle Telegram ${mediaType}:`, error);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramSticker(msg) {
        const topicId    = msg.message_thread_id;
        const whatsappJid = this.findWhatsAppJidByTopic(topicId);
        if (!whatsappJid) return logger.warn('⚠️ Could not find WhatsApp chat for Telegram sticker');

        const sock = this.whatsappBot?.sock;
        if (!sock?.user?.id) return logger.error('❌ WhatsApp socket not ready');

        try {
            await this.sendPresence(whatsappJid, 'composing');

            const fileLink     = await this.telegramBot.getFileLink(msg.sticker.file_id);
            const stickerBuf   = (await axios.get(fileLink, { responseType: 'arraybuffer' })).data;
            const inputPath    = path.join(this.tempDir, `sticker_${Date.now()}.webp`);
            await fs.writeFile(inputPath, stickerBuf);

            let outputBuffer;
            const isAnimated   = msg.sticker.is_animated || msg.sticker.is_video;

            if (isAnimated) {
                const convertedPath = await this.convertAnimatedSticker(inputPath);
                if (!convertedPath) throw new Error('Animated sticker conversion failed');
                outputBuffer = await fs.readFile(convertedPath);
                await fs.unlink(convertedPath).catch(() => {});
            } else {
                const sticker = new Sticker(stickerBuf, {
                    type: StickerTypes.FULL, pack: 'Telegram Stickers', author: 'BridgeBot', quality: 100,
                });
                outputBuffer = await sticker.toBuffer();
            }

            const jid    = this._normalizeJidForSend(whatsappJid);
            const result = await sock.sendMessage(jid, { sticker: outputBuffer });
            await fs.unlink(inputPath).catch(() => {});
            await this.sendPresence(jid, 'available');

            if (result?.key?.id) {
                await this.setReaction(msg.chat.id, msg.message_id, '👍');
            } else {
                throw new Error('Sticker sent but no confirmation key');
            }
        } catch (err) {
            logger.error('❌ Failed to send sticker to WhatsApp:', err);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramLocation(msg) {
        try {
            const whatsappJid = this.findWhatsAppJidByTopic(msg.message_thread_id);
            if (!whatsappJid) return logger.warn('⚠️ Could not find WhatsApp chat for Telegram location');

            const sock = this.whatsappBot?.sock;
            if (!sock?.user?.id) return logger.error('❌ WhatsApp socket not ready');

            const jid        = this._normalizeJidForSend(whatsappJid);
            const sendResult = await sock.sendMessage(jid, {
                location: { degreesLatitude: msg.location.latitude, degreesLongitude: msg.location.longitude },
            });
            await this.sendPresence(jid, 'available');

            if (sendResult?.key?.id) {
                await this.setReaction(msg.chat.id, msg.message_id, '👍');
                if (config.get('telegram.features.readReceipts')) {
                    setTimeout(async () => { try { await sock.readMessages([sendResult.key]); } catch {} }, 1000);
                }
            }
        } catch (error) {
            logger.error('❌ Failed to handle Telegram location:', error);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    async handleTelegramContact(msg) {
        try {
            const whatsappJid = this.findWhatsAppJidByTopic(msg.message_thread_id);
            if (!whatsappJid) return logger.warn('⚠️ Could not find WhatsApp chat for Telegram contact');

            const sock = this.whatsappBot?.sock;
            if (!sock?.user?.id) return logger.error('❌ WhatsApp socket not ready');

            const firstName   = msg.contact.first_name || '';
            const lastName    = msg.contact.last_name  || '';
            const phoneNumber = msg.contact.phone_number || '';
            const displayName = `${firstName} ${lastName}`.trim() || phoneNumber;

            const vcard = `BEGIN:VCARD\nVERSION:3.0\nN:${lastName};${firstName};;;\nFN:${displayName}\nTEL;TYPE=CELL:${phoneNumber}\nEND:VCARD`;

            const jid        = this._normalizeJidForSend(whatsappJid);
            const sendResult = await sock.sendMessage(jid, { contacts: { displayName, contacts: [{ vcard }] } });
            await this.sendPresence(jid, 'available');

            if (sendResult?.key?.id) {
                await this.setReaction(msg.chat.id, msg.message_id, '👍');
                if (config.get('telegram.features.readReceipts')) {
                    setTimeout(async () => { try { await sock.readMessages([sendResult.key]); } catch {} }, 1000);
                }
            }
        } catch (error) {
            logger.error('❌ Failed to handle Telegram contact:', error);
            await this.setReaction(msg.chat.id, msg.message_id, '❌');
        }
    }

    // =========================================================================
    // CALL NOTIFICATION
    // =========================================================================

    async handleCallNotification(callEvent) {
        if (!this.telegramBot || !config.get('telegram.features.callLogs')) return;

        const callKey = `${callEvent.from}_${callEvent.id}`;
        if (this.activeCallNotifications.has(callKey)) return;

        this.activeCallNotifications.set(callKey, true);
        setTimeout(() => this.activeCallNotifications.delete(callKey), 30_000);

        try {
            const resolvedFrom = await this.resolveToPN(callEvent.from);
            const phone        = this.normalizePhone(resolvedFrom);
            const callerName   = this.contactMappings.get(phone) || `+${phone}`;
            const topicId      = await this.getOrCreateTopic('call@broadcast', {
                key: { remoteJid: 'call@broadcast', participant: callEvent.from },
            });

            if (!topicId) return;

            await this.telegramBot.sendMessage(config.get('telegram.chatId'),
                `📞 **Incoming Call**\n\n` +
                `👤 **From:** ${callerName}\n` +
                `📱 **Number:** +${phone}\n` +
                `⏰ **Time:** ${new Date().toLocaleString()}\n` +
                `📋 **Status:** ${callEvent.status || 'Incoming'}`,
                { message_thread_id: topicId, parse_mode: 'Markdown' }
            );
        } catch (error) {
            logger.error('❌ Error handling call notification:', error);
        }
    }

    // =========================================================================
    // READ RECEIPTS
    // =========================================================================

    queueMessageForReadReceipt(chatJid, messageKey) {
        if (!config.get('telegram.features.readReceipts')) return;
        if (!this.messageQueue.has(chatJid)) this.messageQueue.set(chatJid, []);
        this.messageQueue.get(chatJid).push(messageKey);
        setTimeout(() => this.processReadReceipts(chatJid), 2000);
    }

    async processReadReceipts(chatJid) {
        try {
            const messages = this.messageQueue.get(chatJid);
            if (!messages?.length) return;
            if (this.whatsappBot?.sock) {
                await this.whatsappBot.sock.readMessages(messages);
                logger.debug(`📖 Marked ${messages.length} messages as read in ${chatJid}`);
            }
            this.messageQueue.set(chatJid, []);
        } catch (error) {
            logger.debug('Failed to send read receipts:', error);
        }
    }

    async markAsRead(jid, messageKeys) {
        try {
            if (!this.whatsappBot?.sock || !messageKeys.length || !config.get('telegram.features.readReceipts')) return;
            await this.whatsappBot.sock.readMessages(messageKeys);
        } catch (error) {
            logger.debug('Failed to mark messages as read:', error);
        }
    }

    // =========================================================================
    // USER MAPPING
    // =========================================================================

    async createUserMapping(participant, whatsappMsg) {
        if (this.userMappings.has(participant)) {
            const userData = this.userMappings.get(participant);
            userData.messageCount = (userData.messageCount || 0) + 1;
            await this.saveUserMapping(participant, userData);
            return;
        }

        const phone    = participant.split('@')[0].split(':')[0];
        const userData = {
            name:         this.contactMappings.get(phone) || null,
            phone,
            firstSeen:    new Date(),
            messageCount: 1,
        };

        await this.saveUserMapping(participant, userData);
    }

    // =========================================================================
    // WHATSAPP EVENT SUBSCRIPTION
    // =========================================================================

    subscribeToWhatsAppEvents() {
        if (!this.whatsappBot?.sock) {
            logger.warn('Cannot subscribe to WhatsApp events — socket not available');
            return;
        }

        const sock = this.whatsappBot.sock;

        // History sync — strict name only
        sock.ev.on('messaging-history.set', async ({ contacts }) => {
            if (!contacts?.length) return;
            logger.info(`📞 Processing ${contacts.length} contacts from history sync…`);
            let syncedCount = 0;
            for (const contact of contacts) {
                if (!contact?.id || contact.id === 'status@broadcast') continue;
                const phone = contact.id.split('@')[0].split(':')[0];
                const name  = this._resolveContactName(contact, phone);
                if (name) { await this.saveContactMapping(phone, name); syncedCount++; }
            }
            logger.info(`✅ Synced ${syncedCount} contacts from history`);
        });

        // Contact updates — save to DB only, no automatic topic rename
        sock.ev.on('contacts.update', async (updates) => {
            for (const update of updates) {
                if (!update.id || !update.name) continue;
                const phone = update.id.split('@')[0].split(':')[0];
                if (update.name !== phone && !update.name.startsWith('+')) {
                    await this.saveContactMapping(phone, update.name);
                    logger.info(`📞 Contact updated: ${phone} → ${update.name} (use /updatetopics to rename topics)`);
                }
            }
        });

        // New contacts upsert — save to DB only, no automatic topic rename
        sock.ev.on('contacts.upsert', async (updates) => {
            for (const update of updates) {
                if (!update.id || !update.name) continue;
                const phone = update.id.split('@')[0].split(':')[0];
                if (update.name !== phone && !update.name.startsWith('+')) {
                    await this.saveContactMapping(phone, update.name);
                    logger.info(`📞 New contact saved: ${phone} → ${update.name} (use /updatetopics to rename topics)`);
                }
            }
        });

        // Call logs
        sock.ev.on('call', async (callEvents) => {
            for (const callEvent of callEvents) {
                await this.handleCallNotification(callEvent);
            }
        });

        logger.info('📱 WhatsApp event handlers registered');
    }

    async syncWhatsAppConnection() {
        try {
            logger.info(`WhatsApp connected: ${this.whatsappBot.sock.user?.id || 'Unknown'}`);
            this.subscribeToWhatsAppEvents();
            await this.syncContacts();
        } catch (error) {
            logger.error('Error in syncWhatsAppConnection:', error);
        }
    }

    async setupWhatsAppHandlers() {
        if (!this.whatsappBot?.sock) return;
        this.subscribeToWhatsAppEvents();
    }

    // =========================================================================
    // UTILITY
    // =========================================================================

    async resolveToPN(jid) {
        if (!jid) return jid;
        if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us')) return jid;
        try {
            const pn = await this.whatsappBot.sock?.signalRepository?.lidMapping?.getPNForLID(jid);
            if (pn) { logger.info(`[PN] Resolved LID → PN: ${jid} → ${pn}`); return pn; }
        } catch (err) {
            logger.debug(`[PN] Could not resolve LID → PN: ${err.message}`);
        }
        return jid;
    }

    /** Normalize JID to @s.whatsapp.net for sending (groups/newsletters stay as-is) */
    _normalizeJidForSend(jid) {
        if (jid.endsWith('@g.us') || jid.endsWith('@newsletter')) return jid;
        const phone = jid.split('@')[0].split(':')[0];
        return `${phone}@s.whatsapp.net`;
    }

    normalizePhone(jid) {
        if (!jid) return '';
        let phone = jid.split('@')[0];
        if (phone.includes(':')) phone = phone.split(':')[0];
        return phone;
    }

    findWhatsAppJidByTopic(topicId) {
        for (const [jid, topic] of this.chatMappings.entries()) {
            if (topic === topicId) return jid;
        }
        return null;
    }

    extractText(msg) {
        return msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text ||
               msg.message?.imageMessage?.caption ||
               msg.message?.videoMessage?.caption ||
               msg.message?.documentMessage?.caption ||
               msg.message?.audioMessage?.caption ||
               '';
    }

    async streamToBuffer(stream) {
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    }

    async sendSimpleMessage(topicId, text, senderJid) {
        const chatId = config.get('telegram.chatId');
        try {
            const sent = await this.telegramBot.sendMessage(chatId, text, { message_thread_id: topicId });
            return sent.message_id;
        } catch (error) {
            const desc = error.response?.data?.description || error.message;
            if (desc.includes('message thread not found')) {
                logger.warn(`🗑️ Topic ${topicId} missing, recreating for ${senderJid}…`);
                await this.deleteChatMapping(senderJid);
                const newTopicId = await this.getOrCreateTopic(senderJid, { key: { remoteJid: senderJid, participant: senderJid } });
                if (!newTopicId) return null;
                const resent = await this.telegramBot.sendMessage(chatId, text, { message_thread_id: newTopicId });
                return resent.message_id;
            }
            logger.error(`❌ Failed to send message: ${desc}`);
            return null;
        }
    }

    // =========================================================================
    // MEDIA CONVERSION
    // =========================================================================

    async convertToVideoNote(inputPath) {
        return new Promise((resolve) => {
            const outputPath = inputPath.replace('.mp4', '_note.mp4');
            ffmpeg(inputPath)
                .videoFilter('scale=240:240:force_original_aspect_ratio=increase,crop=240:240')
                .duration(60)
                .format('mp4')
                .on('end',   () => resolve(outputPath))
                .on('error', () => resolve(inputPath))
                .save(outputPath);
        });
    }

    async convertAnimatedSticker(inputPath) {
        const outputPath = inputPath.replace('.webp', '-converted.webp');
        return new Promise((resolve) => {
            ffmpeg(inputPath)
                .outputOptions([
                    '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
                    '-loop', '0', '-an', '-vsync', '0',
                ])
                .outputFormat('webp')
                .on('end',   () => resolve(outputPath))
                .on('error', (err) => { logger.debug('Animated sticker conversion failed:', err.message); resolve(null); })
                .save(outputPath);
        });
    }

    // =========================================================================
    // SHUTDOWN
    // =========================================================================

    async shutdown() {
        logger.info('🛑 Shutting down Telegram bridge…');

        if (this.presenceTimeout) clearTimeout(this.presenceTimeout);

        if (this.telegramBot) {
            try {
                await this.telegramBot.stopPolling();
                logger.info('📱 Telegram bot polling stopped');
            } catch (error) {
                logger.debug('Error stopping Telegram polling:', error);
            }
        }

        try {
            await fs.emptyDir(this.tempDir);
            logger.info('🧹 Temp directory cleaned');
        } catch (error) {
            logger.debug('Could not clean temp directory:', error);
        }

        logger.info('✅ Telegram bridge shutdown complete');
    }
}

export default TelegramBridge;
