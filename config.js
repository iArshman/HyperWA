import dotenv from 'dotenv';
dotenv.config();

class Config {
    constructor() {
        this.defaultConfig = {
            bot: {
                name: 'HyperWa',
                company: 'Dawium Technologies',
                prefix: '.',
                version: '3.0.0',
                owner: process.env.OWNER_NUMBER || '92307541232@s.whatsapp.net',
                clearAuthOnStart: false
            },

            auth: {
                useMongoAuth: true,
                clearAuthOnStart: false
            },

            admins: [
                '923/////',
                '92333////'
            ],

            features: {
                mode: 'private',
                customModules: true,
                rateLimiting: true,
                autoReply: false,
                autoViewStatus: false,
                telegramBridge: true,
                respondToUnknownCommands: false,
                sendPermissionError: false
            },

            mongo: {
                uri: process.env.MONGO_URI || 'mongodb+srv://%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
                dbName: process.env.MONGO_DB_NAME || 'HyperWA'
            },

            telegram: {
                enabled: process.env.TELEGRAM_ENABLED || 'false',
                botToken: process.env.BOT_TOKEN || '8340169817:AAE3p5yc0%%%%%%%%%%%%%%%%%%%%%%',
                botPassword: '1122',
                chatId: process.env.TELEGRAM_GROUP_ID || '-1002846269080',
                logChannel: '-100000000000',
                features: {
                    topics: true,
                    mediaSync: true,
                    profilePicSync: false,
                    syncPrivate: true,     // Toggle individual chats
                    syncGroups: false,      // Toggle group chats
                    syncNewsletters: false, // Toggle WhatsApp Channels
                    callLogs: true,
                    readReceipts: false,
                    statusSync: false,
                    biDirectional: true,
                    welcomeMessage: false,
                    sendOutgoingMessages: false,
                    onlinePresence: false,   // Show "online" (available) when replying
                    typingPresence: true,   // Show "typing…" (composing) when replying
                    animatedStickers: true
                }
            },

            gemini: {
                // Comma-separated list, e.g. GEMINI_API_KEYS=key1,key2,key3 in your .env
                // When one key hits its quota/rate limit, the module automatically
                // rotates to the next key in this list.
                apiKeys: process.env.GEMINI_API_KEYS
                    ? process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean)
                    : [
                        // Fallback defaults (move these to .env as GEMINI_API_KEYS instead of
                        // committing real keys here).
                        "AQ.Ab8RN6KYBqj7oZQ7cmq4wRF__pJb2sqN6oBQk53iysUy91FPIg",
                        "AQ.Ab8RN6L2K_O_dSTmdwKAF7ErRh4RPPNaVeK32Ycrouks2DFJMw"
                      ],
                model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview'
            },
            

            help: {
                defaultStyle: 1,
                defaultShow: 'description'
            },

            logging: {
                level: 'info',
                saveToFile: true,
                maxFileSize: '10MB',
                maxFiles: 5
            },

            store: {
                filePath: './whatsapp-store.json',
                autoSaveInterval: 30000
            },

            security: {
                blockedUsers: [],
                maxFileSize: '10MB',
                maxFiles: 5
            },

            messages: {
                autoReplyText: 'Hello! This is an automated response. I\'ll get back to you soon.',
                welcomeText: 'Welcome to the group!',
                goodbyeText: 'Goodbye! Thanks for being part of our community.',
                errorText: 'Something went wrong. Please try again later.'
            }
        };

        this.load();
    }

    load() {
        this.config = { ...this.defaultConfig };
        console.log('✅ Configuration loaded (ENV supported)');
    }

    get(key) {
        return key.split('.').reduce((o, k) => o && o[k], this.config);
    }

    set(key, value) {
        const keys = key.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((o, k) => {
            if (typeof o[k] === 'undefined') o[k] = {};
            return o[k];
        }, this.config);
        target[lastKey] = value;
        console.warn(`⚠️ Config key '${key}' was set to '${value}' (in-memory only).`);
    }

    update(updates) {
        this.config = { ...this.config, ...updates };
        console.warn('⚠️ Config was updated in memory. Not persistent.');
    }
}

const config = new Config();
export default config;
