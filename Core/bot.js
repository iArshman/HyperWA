const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, getAggregateVotesInPollMessage, isJidNewsletter, delay, proto } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs-extra');
const path = require('path');
const NodeCache = require('node-cache');

const config = require('../config');
const logger = require('./logger');
const MessageHandler = require('./message-handler');
const { connectDb } = require('../utils/db');
const ModuleLoader = require('./module-loader');
const { useMongoAuthState } = require('../utils/mongoAuthState');
const { makeInMemoryStore } = require('../utils/store');
const msgRetryCounterCache = new NodeCache();

class HyperWaBot {
    constructor() {
        this.sock = null;
        this.store = makeInMemoryStore({ logger: logger.child({ module: 'store' }) });
        this.store.loadFromFile();
        this.authPath = './auth_info';
        this.messageHandler = new MessageHandler(this);
        this.telegramBridge = null;
        this.isShuttingDown = false;
        this.db = null;
        this.moduleLoader = new ModuleLoader(this);
        this.qrCodeSent = false;
        this.useMongoAuth = config.get('auth.useMongoAuth', false);
        this.messageStore = new Map();


        // Memory cleanup: keep messages < 10 mins old
        setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            for (const [id, message] of this.messageStore) {
                const msgTime = (message.messageTimestamp || 0) * 1000;
                if (now - msgTime > 10 * 60 * 1000) { // 10 minutes
                    this.messageStore.delete(id);
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                logger.debug(`🧹 Message store cleaned: ${cleaned} old messages removed`);
            }
        }, 300000); // Every 5 minutes
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot...');

        try {
            this.db = await connectDb();
            logger.info('✅ Database connected successfully!');
        } catch (error) {
            logger.error('❌ Failed to connect to database:', error);
            process.exit(1);
        }

        if (config.get('telegram.enabled')) {
            try {
                const TelegramBridge = require('../telegram/bridge');
                this.telegramBridge = new TelegramBridge(this);
                await this.telegramBridge.initialize();
                logger.info('✅ Telegram bridge initialized');

                try {
                    await this.telegramBridge.sendStartMessage();
                } catch (err) {
                    logger.warn('⚠️ Failed to send start message via Telegram:', err.message);
                }
            } catch (error) {
                logger.warn('⚠️ Telegram bridge failed to initialize:', error.message);
                this.telegramBridge = null;
            }
        }

        await this.store.loadFromFile();
        await this.moduleLoader.loadModules();
        await this.startSock();

        logger.info('✅ HyperWa Userbot initialized successfully!');
    }

    async startSock() {
        let state, saveCreds;

        // Clean up existing socket
        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        // Choose auth method
        if (this.useMongoAuth) {
            logger.info('🔧 Using MongoDB auth state...');
            try {
                ({ state, saveCreds } = await useMongoAuthState());
            } catch (error) {
                logger.error('❌ Failed to initialize MongoDB auth state:', error);
                logger.info('🔄 Falling back to file-based auth...');
                ({ state, saveCreds } = await useMultiFileAuthState(this.authPath));
            }
        } else {
            logger.info('🔧 Using file-based auth state...');
            ({ state, saveCreds } = await useMultiFileAuthState(this.authPath));
        }

        // Wait for files to settle (critical for keys/)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Fetch latest WA version
        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        try {
            this.sock = makeWASocket({
                version,
                logger: logger.child({ module: 'baileys' }),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'signal-keys' })),
                },
                msgRetryCounterCache,
                generateHighQualityLinkPreview: true,
                getMessage: this.getMessage.bind(this),
                browser: ['HyperWa', 'Chrome', '3.0'],
                syncFullHistory: false,
                markOnlineOnConnect: true,
                firewall: false,
            });

            // Bind store
            this.store.bind(this.sock.ev);

            // Process events
            this.sock.ev.process(async (events) => {
                if (events['connection.update']) {
                    const update = events['connection.update'];
                    const { connection, lastDisconnect, qr } = update;

                    if (qr) {
                        logger.info('📱 WhatsApp QR code generated');
                        qrcode.generate(qr, { small: true });

                        if (this.telegramBridge) {
                            try {
                                await this.telegramBridge.sendQRCode(qr);
                            } catch (error) {
                                logger.warn('⚠️ TelegramBridge failed to send QR:', error.message);
                            }
                        }
                    }

                    if (connection === 'close') {
                        // reconnect if not logged out
                        if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
                            if (!this.isShuttingDown) {
                                logger.warn('🔄 Connection closed, reconnecting...');
                                this.startSock();
                            }
                        } else {
                            logger.error('❌ Connection closed permanently. Clearing session...');
                            if (this.useMongoAuth) {
                                try {
                                    const db = await connectDb();
                                    const coll = db.collection("auth");
                                    await coll.deleteOne({ _id: "session" });
                                    logger.info('🗑️ MongoDB auth session cleared');
                                } catch (error) {
                                    logger.error('❌ Failed to clear MongoDB auth session:', error);
                                }
                            }
                            process.exit(1);
                        }
                    } else if (connection === 'open') {
                        await this.onConnectionOpen();
                    }

                    logger.info('Connection update:', update);
                }


                if (events['creds.update']) {
                    await saveCreds();
                }

                if (events['labels.association']) {
                    logger.info('📋 Label association update:', events['labels.association']);
                }

                if (events['labels.edit']) {
                    logger.info('📝 Label edit update:', events['labels.edit']);
                }

                if (events.call) {
                    logger.info('📞 Call event received:', events.call);
                }

                if (events['messaging-history.set']) {
                    const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set'];
                    if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
                        logger.info('📥 Received on-demand history sync, messages:', messages.length);
                    }
                    logger.info(`📊 History sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (latest: ${isLatest}, progress: ${progress}%)`);
                }

                if (events['messages.upsert']) {
                    const upsert = events['messages.upsert'];
                    logger.debug('Received messages:', JSON.stringify(upsert, null, 2));

                    if (upsert.requestId) {
                        logger.info(`📥 Placeholder message received for request ID: ${upsert.requestId}`);
                    }

                    // Store messages for decryption retries
                    for (const msg of upsert.messages) {
                        if (msg.key?.id && msg.message) {
                            this.messageStore.set(msg.key.id, msg.message);
                        }
                    }

                    if (upsert.type === 'notify') {
                        for (const msg of upsert.messages) {
                            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                            if (text === "requestPlaceholder" && !upsert.requestId) {
                                const messageId = await this.sock.requestPlaceholderResend(msg.key);
                                logger.info('🔄 Requested placeholder resync, ID:', messageId);
                            }
                            if (text === "onDemandHistSync") {
                                const messageId = await this.sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
                                logger.info('📥 Requested on-demand sync, ID:', messageId);
                            }
                        }
                    }

                    try {
                        await this.messageHandler.handleMessages({ messages: upsert.messages, type: upsert.type });
                    } catch (error) {
                        logger.warn('⚠️ Message handler error:', error.message);
                    }
                }

                if (events['messages.update']) {
                    logger.debug('Messages update:', JSON.stringify(events['messages.update'], null, 2));
                    for (const { key, update } of events['messages.update']) {
                        if (update.pollUpdates) {
                            const pollCreation = this.messageStore.get(key.id);
                            if (pollCreation) {
                                logger.info('📊 Poll update received, aggregation:', 
                                    getAggregateVotesInPollMessage({
                                        message: { message: pollCreation },
                                        pollUpdates: update.pollUpdates,
                                    })
                                );
                            }
                        }
                    }
                }

                if (events['message-receipt.update']) {
                    logger.debug('📨 Message receipt update:', events['message-receipt.update']);
                }

                if (events['messages.reaction']) {
                    logger.info('😀 Message reactions:', events['messages.reaction']);
                }

                if (events['presence.update']) {
                    logger.debug('👤 Presence update:', events['presence.update']);
                }

                if (events['chats.update']) {
                    logger.debug('💬 Chats updated:', events['chats.update']);
                }

                if (events['contacts.update']) {
                    for (const contact of events['contacts.update']) {
                        if (typeof contact.imgUrl !== 'undefined') {
                            const newUrl = contact.imgUrl === null
                                ? null
                                : await this.sock.profilePictureUrl(contact.id).catch(() => null);
                            logger.info(`👤 Contact ${contact.id} has a new profile pic: ${newUrl}`);
                        }
                    }
                }

                if (events['chats.delete']) {
                    logger.info('🗑️ Chats deleted:', events['chats.delete']);
                }
            });

        } catch (error) {
            logger.error('❌ Failed to initialize WhatsApp socket:', error);
            logger.info('🔄 Retrying in 5 seconds...');
            setTimeout(() => this.startSock(), 5000);
        }
    }

    // Reliable getMessage for decryption retries
    async getMessage(key) {
        try {
            if (key.id && this.messageStore.has(key.id)) {
                return this.messageStore.get(key.id);
            }

            if (this.store) {
                const msg = await Promise.race([
                    this.store.loadMessage(key.remoteJid, key.id),
                    new Promise(resolve => setTimeout(resolve, 2000)) // 2s timeout
                ]);
                return msg?.message;
            }

            return undefined;
        } catch (error) {
            logger.warn('⚠️ Error in getMessage:', error.message);
            return undefined;
        }
    }

    async onConnectionOpen() {
        logger.info(`✅ Connected to WhatsApp! User: ${this.sock.user?.id || 'Unknown'}`);


        if (!config.get('bot.owner') && this.sock.user) {
            config.set('bot.owner', this.sock.user.id);
            logger.info(`👑 Owner set to: ${this.sock.user.id}`);
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.setupWhatsAppHandlers();
            } catch (err) {
                logger.warn('⚠️ Failed to setup Telegram WhatsApp handlers:', err.message);
            }
        }

        await this.sendStartupMessage();

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.syncWhatsAppConnection();
            } catch (err) {
                logger.warn('⚠️ Telegram sync error:', err.message);
            }
        }
    }

    async sendStartupMessage() {
        const owner = config.get('bot.owner');
        if (!owner) return;

        const startupMessage = `🚀 *${config.get('bot.name')} v${config.get('bot.version')}* is now online!\n\n` +
                              `🔥 *HyperWa Features Active:*\n` +
                              `• 🤖 Telegram Bridge: ${config.get('telegram.enabled') ? '✅' : '❌'}\n` +
                              `• 🔄 Auto Replies: ${this.doReplies ? '✅' : '❌'}\n` +
                              `Type *${config.get('bot.prefix')}help* for available commands!`;

        try {
            await this.sendMessage(owner, { text: startupMessage });
        } catch (err) {
            logger.warn('⚠️ Failed to send startup message:', err.message);
        }

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.logToTelegram('🚀 HyperWa Bot Started', startupMessage);
            } catch (err) {
                logger.warn('⚠️ Telegram log failed:', err.message);
            }
        }
    }

    async connect() {
        if (!this.sock) {
            await this.startSock();
        }
        return this.sock;
    }

    async sendMessage(jid, content) {
        if (!this.sock) {
            throw new Error('WhatsApp socket not initialized');
        }
        return await this.sock.sendMessage(jid, content);
    }

    async shutdown() {
        logger.info('🛑 Shutting down HyperWa Userbot...');
        this.isShuttingDown = true;

        if (this.telegramBridge) {
            try {
                await this.telegramBridge.shutdown();
            } catch (err) {
                logger.warn('⚠️ Telegram shutdown error:', err.message);
            }
        }

        if (this.sock) {
            await this.sock.end();
        }


        logger.info('✅ HyperWa Userbot shutdown complete');
    }
}

module.exports = { HyperWaBot };
