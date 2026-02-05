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
                enabled: false,
                botToken: process.env.BOT_TOKEN || '8340169817:AAE3p5yc0%%%%%%%%%%%%%%%%%%%%%%',
                botPassword: '1122',
                chatId: process.env.TELEGRAM_GROUP_ID || '-1002846269080',
                logChannel: '-100000000000',
                features: {
                    topics: true,
                    mediaSync: true,
                    profilePicSync: false,
                    callLogs: true,
                    readReceipts: false,
                    statusSync: true,
                    biDirectional: true,
                    welcomeMessage: false,
                    sendOutgoingMessages: false,
                    presenceUpdates: true,
                    animatedStickers: true
                }
            },

            assistant: {
                enabled: false,
                learningMode: true,
                suggestionThreshold: 0.6
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
