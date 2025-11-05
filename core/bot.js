import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore, 
    getAggregateVotesInPollMessage, 
    isJidNewsletter, 
    delay, 
    isPnUser,
    proto 
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs-extra';
import path from 'path';
import NodeCache from '@cacheable/node-cache';
import { makeInMemoryStore } from '../utils/store.js';
import config from '../config.js';
import logger from './logger.js';
import MessageHandler from './message-handler.js';
import { connectDb } from '../utils/db.js';
import ModuleLoader from './module-loader.js';
import { useMongoAuthState } from '../utils/mongoAuthState.js';

class HyperWaBot {
    constructor() {
        this.sock = null;
        this.authPath = './auth_info';
        this.messageHandler = new MessageHandler(this);
        this.telegramBridge = null;
        this.isShuttingDown = false;
        this.db = null;
        this.moduleLoader = new ModuleLoader(this);
        this.qrCodeSent = false;
        this.useMongoAuth = config.get('auth.useMongoAuth', false);
        this.isFirstConnection = true;
        // Initialize the  store
        this.store = makeInMemoryStore({
        logger: logger.child({ module: 'store' }),
        filePath: './whatsapp-store.json',
        autoSaveInterval: 30000
    });
    
    // Load existing data
    this.store.loadFromFile();
    
    // cache setup
    this.msgRetryCounterCache = new NodeCache();
    this.onDemandMap = new Map();
    
    // Memory cleanup
    setInterval(() => {
        if (this.onDemandMap.size > 100) {
            this.onDemandMap.clear();
        }
    }, 300000); // 5 minutes


        // Store event listeners for advanced features
        this.setupStoreEventListeners();
    }

    setupStoreEventListeners() {
        // Monitor store events for analytics and features
        this.store.on('messages.upsert', (data) => {
            logger.debug(`📝 Store: ${data.messages.length} messages cached`);
        });

        this.store.on('contacts.upsert', (contacts) => {
            logger.debug(`👥 Store: ${contacts.length} contacts cached`);
        });

        this.store.on('chats.upsert', (chats) => {
            logger.debug(`💬 Store: ${chats.length} chats cached`);
        });

    }

    getStoreStats() {
        const chatCount = Object.keys(this.store.chats).length;
        const contactCount = Object.keys(this.store.contacts).length;
        const messageCount = Object.values(this.store.messages)
            .reduce((total, chatMessages) => total + Object.keys(chatMessages).length, 0);
        
        return {
            chats: chatCount,
            contacts: contactCount,
            messages: messageCount
        };
    }

    async initialize() {
        logger.info('🔧 Initializing HyperWa Userbot');

        try {
            this.db = await connectDb();
            logger.info('✅ Database connected successfully!');
        } catch (error) {
            logger.error('❌ Failed to connect to database:', error);
            process.exit(1);
        }

        if (config.get('telegram.enabled')) {
            try {
                const { default: TelegramBridge } = await import('../telegram/bridge.js');
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

        await this.moduleLoader.loadModules();
        await this.startWhatsApp();

        logger.info('✅ HyperWa Userbot initialized successfully!');
    }

    async startWhatsApp() {
        let state, saveCreds;

        // Clean up existing socket if present
        if (this.sock) {
            logger.info('🧹 Cleaning up existing WhatsApp socket');
            this.sock.ev.removeAllListeners();
            await this.sock.end();
            this.sock = null;
        }

        // Choose auth method based on configuration
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

        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info(`📱 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        try {
            this.sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'keys' })),
        },
        version,
        logger: logger.child({ module: 'baileys' }),
        msgRetryCounterCache: this.msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        getMessage: this.getMessage.bind(this), 
        browser: ['HyperWa', 'Chrome', '3.0'],
        markOnlineOnConnect: false ,
        syncFullHistory: true,
        firewall: true,
        printQRInTerminal: false
    });

    // ✅ CRITICAL: Bind store to socket events
    this.store.bind(this.sock.ev);
    logger.info('🔗 Store bound to socket');
            const connectionPromise = new Promise((resolve, reject) => {
                const connectionTimeout = setTimeout(() => {
                    if (!this.sock.user) {
                        logger.warn('❌ QR code scan timed out after 30 seconds');
                        this.sock.ev.removeAllListeners();
                        this.sock.end();
                        this.sock = null;
                        reject(new Error('QR code scan timed out'));
                    }
                }, 30000);

                this.sock.ev.on('connection.update', update => {
                    if (update.connection === 'open') {
                        clearTimeout(connectionTimeout);
                        resolve();
                    }
                });
            });

            this.setupEnhancedEventHandlers(saveCreds);
            await connectionPromise;
        } catch (error) {
            logger.error('❌ Failed to initialize WhatsApp socket:', error);
            logger.info('🔄 Retrying with new QR code...');
            setTimeout(() => this.startWhatsApp(), 5000);
        }
    }

    // Enhanced getMessage with store lookup
    async getMessage(key) {
    try {
        if (!key?.remoteJid || !key?.id) {
            return undefined;
        }

        // ✅ Try to get from store first
        const storedMessage = this.store.loadMessage(key.remoteJid, key.id);
        if (storedMessage?.message) {
            logger.debug(`📨 Retrieved from store: ${key.id}`);
            return storedMessage.message;
        }

        // ✅ Return undefined (Baileys will handle retry)
        // Never return fake messages - causes decryption issues
        return undefined;
        
    } catch (error) {
        logger.debug('⚠️ getMessage error:', error.message);
        return undefined;
    }
}




    setupEnhancedEventHandlers(saveCreds) {
        this.sock.ev.process(async (events) => {
            try {
                if (events['connection.update']) {
                    await this.handleConnectionUpdate(events['connection.update']);
                }

                if (events['creds.update']) {
                    await saveCreds();
                }

                if (events['messages.upsert']) {
                    await this.handleMessagesUpsert(events['messages.upsert']);
                }

                // Store automatically handles most events, but we can add custom logic
                if (!process.env.DOCKER) {
                    if (events['labels.association']) {
                        logger.info('📋 Label association update:', events['labels.association']);
                    }

                    if (events['labels.edit']) {
                        logger.info('📝 Label edit update:', events['labels.edit']);
                    }

                    if (events.call) {
                        logger.info('📞 Call event received:', events.call);
                        // Store call information
                        for (const call of events.call) {
                            this.store.setCallOffer(call.from, call);
                        }
                    }

                    if (events['messaging-history.set']) {
                        const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set'];
                        if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
                            logger.info('📥 Received on-demand history sync, messages:', messages.length);
                        }
                        logger.info(`📊 History sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (latest: ${isLatest}, progress: ${progress}%)`);
                    }

                    if (events['messages.update']) {
                        for (const { key, update } of events['messages.update']) {
                            if (update.pollUpdates) {
                                logger.info('📊 Poll update received');
                            }
                        }
                    }

                    if (events['message-receipt.update']) {
                        logger.debug('📨 Message receipt update');
                    }

                    if (events['messages.reaction']) {
                        logger.info(`😀 Message reactions: ${events['messages.reaction'].length}`);
                    }

                    if (events['presence.update']) {
                        logger.debug('👤 Presence updates');
                    }

                    if (events['chats.update']) {
                        logger.debug('💬 Chats updated');
                    }

                    if (events['contacts.update']) {
                        for (const contact of events['contacts.update']) {
                            if (typeof contact.imgUrl !== 'undefined') {
                                logger.info(`👤 Contact ${contact.id} profile pic updated`);
                            }
                        }
                    }

                    if (events['chats.delete']) {
                        logger.info('🗑️ Chats deleted:', events['chats.delete']);
                    }
                }
            } catch (error) {
                logger.warn('⚠️ Event processing error:', error.message);
            }
        });
    }

    async handleConnectionUpdate(update) {
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
            const statusCode = lastDisconnect?.error?.output?.statusCode || 0;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect && !this.isShuttingDown) {
                logger.warn('🔄 Connection closed, reconnecting...');
                // Save store before reconnecting
                this.store.saveToFile();
                setTimeout(() => this.startWhatsApp(), 5000);
            } else {
                logger.error('❌ Connection closed permanently. Please delete auth_info and restart.');

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

                // Final store save
                this.store.saveToFile();
                process.exit(1);
            }
        } else if (connection === 'open') {
            await this.onConnectionOpen();
        }
    }

    async handleMessagesUpsert(upsert) {
        if (upsert.type === 'notify') {
            for (const msg of upsert.messages) {
                try {
                    await this.processIncomingMessage(msg, upsert);
                } catch (error) {
                    logger.warn('⚠️ Message processing error:', error.message);
                }
            }
        }

        try {
            await this.messageHandler.handleMessages({ messages: upsert.messages, type: upsert.type });
        } catch (error) {
            logger.warn('⚠️ Original message handler error:', error.message);
        }
    }

    async processIncomingMessage(msg, upsert) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        
        if (!text) return;

        // Handle special commands
        if (text === "requestPlaceholder" && !upsert.requestId) {
            const messageId = await this.sock.requestPlaceholderResend(msg.key);
            logger.info('🔄 Requested placeholder resync, ID:', messageId);
            return;
        }

        if (text === "onDemandHistSync") {
            const messageId = await this.sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp);
            logger.info('📥 Requested on-demand sync, ID:', messageId);
            return;
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

    // Only send startup message on first connection
    if (this.isFirstConnection) {
        await this.sendStartupMessage();
        this.isFirstConnection = false;
    } else {
        logger.info('🔄 Reconnected - skipping startup message');
    }

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

        const authMethod = this.useMongoAuth ? 'MongoDB' : 'File-based';
        const storeStats = this.getStoreStats();
        
        const startupMessage = `🚀 *${config.get('bot.name')} v${config.get('bot.version')}* is now online!\n\n` +
                              `🔥 *HyperWa Features Active:*\n` +
                              `• 🤖 Telegram Bridge: ${config.get('telegram.enabled') ? '✅' : '❌'}\n` +
                              `Type *${config.get('bot.prefix')}help* for available commands!`;

        try {
            await this.sendMessage(owner, { text: startupMessage });
        } catch {}

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
            await this.startWhatsApp();
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

        // Cleanup store
        this.store.cleanup();

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

export { HyperWaBot };
export default HyperWaBot;
