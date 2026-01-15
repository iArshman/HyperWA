import {  GoogleGenerativeAI, HarmBlockThreshold, HarmCategory  } from '@google/generative-ai';
import {  downloadContentFromMessage  } from '@whiskeysockets/baileys';
import config from '../config.js';
import logger from '../core/logger.js';
import * as dbModule from '../utils/db.js'; 
const Database = dbModule.default || dbModule.Database || dbModule;

class ChatBotModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'chatbot';
        this.metadata = {
            description: 'Advanced chatbot with Gemini AI, conversation memory, and per-user/group settings',
            version: '1.2.0',
            author: 'HyperWa Team',
            category: 'ai'
        };

        // Gemini API configuration
        this.apiKey = "AIzaSyCjsufhrqepM1uYNji8hwhf_mQnDCjKL60"; // Consider moving to config
        this.genAI = null;
        this.model = null;

        // Database configuration
        this.db = null;
        this.collection = null;

        // Chatbot state
        this.globalChatEnabled = false;
        this.userChatSettings = new Map(); // userId -> enabled/disabled
        this.groupChatSettings = new Map(); // groupId -> enabled/disabled
        this.conversations = new Map(); // userId/groupId -> conversation history
        this.maxConversationLength = 20;

        // Bot default role
        this.defaultRole = `You are HyperWa, an advanced AI assistant integrated into a WhatsApp bot. You are:
- Helpful, friendly, and knowledgeable
- Capable of understanding context and maintaining conversations
- Able to analyze text and images to provide comprehensive answers.
- Integrated with multiple bot modules and features
- Smart and witty, but professional
- Always ready to help users with their needs

Keep responses concise but informative. Be engaging and personable.`;

        this.commands = [
            {
                name: 'chat',
                description: 'Toggle chatbot for user/group or globally',
                usage: '.chat on/off [user_number]',
                aliases: ['c'],
                permissions: 'admin',
                ui: {
                    processingText: 'Processing Chat Toggle...',
                    errorText: 'Chat Toggle Failed'
                },
                execute: this.toggleChat.bind(this)
            },
            {
                name: 'chatall',
                description: 'Toggle global chatbot for all users',
                usage: '.chatall on/off',
                permissions: 'owner',
                ui: {
                    processingText: 'Processing Global Chat...',
                    errorText: 'Global Chat Toggle Failed'
                },
                execute: this.toggleGlobalChat.bind(this)
            },
            {
                name: 'groupchat',
                description: 'Toggle chatbot for current group',
                usage: '.groupchat on/off',
                aliases: ['gc'],
                permissions: 'admin',
                ui: {
                    processingText: 'Processing Group Chat...',
                    errorText: 'Group Chat Toggle Failed'
                },
                execute: this.toggleGroupChat.bind(this)
            },
            {
                name: 'chatstatus',
                description: 'Check chatbot status',
                usage: '.chatstatus',
                permissions: 'public',
                ui: {
                    processingText: 'Checking Status...',
                    errorText: 'Status Check Failed'
                },
                execute: this.getChatStatus.bind(this)
            },
            {
                name: 'chatdel',
                description: 'Delete conversation history',
                usage: '.chatdel [user_number] OR .chatdel all',
                permissions: 'admin',
                ui: {
                    processingText: 'Deleting Chat History...',
                    errorText: 'Delete Chat Failed'
                },
                execute: this.deleteChatHistory.bind(this)
            },
            {
                name: 'botrole',
                description: 'Set global bot role (owner only)',
                usage: '.botrole <role_description>',
                permissions: 'owner',
                ui: {
                    processingText: 'Setting Global Role...',
                    errorText: 'Role Update Failed'
                },
                execute: this.setBotRole.bind(this)
            },
            {
                name: 'setrole',
                description: 'Set bot role for yourself or specific user',
                usage: '.setrole <role_description> [user_number]',
                aliases: ['role'],
                permissions: 'public',
                ui: {
                    processingText: 'Setting Personal Role...',
                    errorText: 'Role Update Failed'
                },
                execute: this.setPersonalRole.bind(this)
            },
            {
                name: 'resetrole',
                description: 'Reset to default role',
                usage: '.resetrole [user_number]',
                aliases: ['rr'],
                permissions: 'public',
                ui: {
                    processingText: 'Resetting Role...',
                    errorText: 'Role Reset Failed'
                },
                execute: this.resetPersonalRole.bind(this)
            },
            {
                name: 'chathelp',
                description: 'Show chatbot help and features',
                usage: '.chathelp',
                permissions: 'public',
                ui: {
                    processingText: 'Loading Help...',
                    errorText: 'Help Load Failed'
                },
                execute: this.showChatHelp.bind(this)
            }
        ];

        // Message hooks for chat processing
        this.messageHooks = {
            'pre_process': this.handleChatMessage.bind(this)
        };
    }

    async init() {
        try {
            // Initialize database
            this.db = this.bot.db;
            this.collection = this.db.collection('chatbot_data');
            
            // Create indexes for better performance
            await this.collection.createIndex({ userId: 1 });
            await this.collection.createIndex({ groupId: 1 });
            await this.collection.createIndex({ conversationId: 1 });
            await this.collection.createIndex({ type: 1 });
            
            // Load settings from database
            await this.loadSettingsFromDb();
            
            if (!this.apiKey || this.apiKey === "YOUR_GEMINI_API_KEY") {
                logger.error('Gemini API key is missing for ChatBot module');
                throw new Error('Gemini API key not configured');
            }

            this.genAI = new GoogleGenerativeAI(this.apiKey);
            this.model = this.genAI.getGenerativeModel({ 
                model: "gemini-2.0-flash",
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ]
            });

        } catch (error) {
            logger.error('Failed to initialize ChatBot module:', error);
            throw error;
        }
    }

    async loadSettingsFromDb() {
        try {
            const settings = await this.collection.findOne({ type: 'globalSettings' });
            if (settings) {
                this.globalChatEnabled = settings.globalChatEnabled || false;
            }
            
            const userSettings = await this.collection.find({ type: 'userSettings' }).toArray();
            for (const setting of userSettings) {
                this.userChatSettings.set(setting.userId, setting.enabled);
            }
            
            const groupSettings = await this.collection.find({ type: 'groupSettings' }).toArray();
            for (const setting of groupSettings) {
                this.groupChatSettings.set(setting.groupId, setting.enabled);
            }
            
            logger.info('✅ Loaded chatbot settings from database');
        } catch (error) {
            logger.error('❌ Error loading chatbot settings:', error);
        }
    }

    async saveSettingsToDb() {
        try {
            // Save global settings
            await this.collection.updateOne(
                { type: 'globalSettings' },
                { $set: { globalChatEnabled: this.globalChatEnabled, updatedAt: new Date() } },
                { upsert: true }
            );
            
            // Save user settings
            for (const [userId, enabled] of this.userChatSettings) {
                await this.collection.updateOne(
                    { type: 'userSettings', userId },
                    { $set: { enabled, updatedAt: new Date() } },
                    { upsert: true }
                );
            }
            
            // Save group settings
            for (const [groupId, enabled] of this.groupChatSettings) {
                await this.collection.updateOne(
                    { type: 'groupSettings', groupId },
                    { $set: { enabled, updatedAt: new Date() } },
                    { upsert: true }
                );
            }
        } catch (error) {
            logger.error('❌ Error saving chatbot settings:', error);
        }
    }

    async toggleChat(msg, params, context) {
        try {
            const action = params[0]?.toLowerCase();
            const targetUser = params[1];

            if (!action || !['on', 'off'].includes(action)) {
                return await this.getChatStatus(msg, params, context);
            }

            const isGroup = context.sender.endsWith('@g.us');
            const enabled = action === 'on';

            if (targetUser) {
                // Toggle for specific user
                const userId = targetUser.replace(/[^\d]/g, '');
                if (!userId) {
                    return 'Invalid user number format. Please provide a valid phone number.';
                }

                this.userChatSettings.set(userId, enabled);
                await this.saveSettingsToDb();
                return `Chat ${enabled ? 'Enabled' : 'Disabled'} for +${userId}`;

            } else if (isGroup) {
                // Toggle for current group
                this.groupChatSettings.set(context.sender, enabled);
                await this.saveSettingsToDb();
                return `Group Chat ${enabled ? 'Enabled' : 'Disabled'}`;

            } else {
                // Toggle for current user
                const userId = context.participant.split('@')[0];
                this.userChatSettings.set(userId, enabled);
                await this.saveSettingsToDb();
                return `Chat ${enabled ? 'Enabled' : 'Disabled'}`;
            }
        } catch (error) {
            logger.error('Error in toggleChat:', error);
            return 'Failed to toggle chat settings. Please try again.';
        }
    }

    async toggleGlobalChat(msg, params, context) {
        try {
            const action = params[0]?.toLowerCase();

            if (!action || !['on', 'off'].includes(action)) {
                return `Global Chat Status: ${this.globalChatEnabled ? 'ENABLED' : 'DISABLED'}\n\nUsage: .chatall on/off`;
            }

            this.globalChatEnabled = action === 'on';
            await this.saveSettingsToDb();
            return `Global Chat ${this.globalChatEnabled ? 'Enabled' : 'Disabled'}`;
        } catch (error) {
            logger.error('Error in toggleGlobalChat:', error);
            return 'Failed to toggle global chat. Please try again.';
        }
    }

    async toggleGroupChat(msg, params, context) {
        try {
            if (!context.sender.endsWith('@g.us')) {
                return 'This command can only be used in group chats.';
            }

            const action = params[0]?.toLowerCase();

            if (!action || !['on', 'off'].includes(action)) {
                const currentStatus = this.groupChatSettings.get(context.sender) || false;
                return `Group Chat Status: ${currentStatus ? 'ENABLED' : 'DISABLED'}\n\nUsage: .groupchat on/off`;
            }

            const enabled = action === 'on';
            this.groupChatSettings.set(context.sender, enabled);
            await this.saveSettingsToDb();
            return `Group Chat ${enabled ? 'Enabled' : 'Disabled'}`;
        } catch (error) {
            logger.error('Error in toggleGroupChat:', error);
            return 'Failed to toggle group chat. Please try again.';
        }
    }

    async getChatStatus(msg, params, context) {
        try {
            const isGroup = context.sender.endsWith('@g.us');
            const userId = context.participant.split('@')[0];

            let status = `ChatBot Status Report\n\n`;
            status += `Global Chat: ${this.globalChatEnabled ? 'ENABLED' : 'DISABLED'}\n`;

            if (isGroup) {
                const groupEnabled = this.groupChatSettings.get(context.sender) || false;
                status += `This Group: ${groupEnabled ? 'ENABLED' : 'DISABLED'}\n`;
            }

            const userEnabled = this.userChatSettings.get(userId);
            const userStatus = userEnabled !== undefined ? userEnabled : this.globalChatEnabled;
            status += `Your Chat: ${userStatus ? 'ENABLED' : 'DISABLED'}\n`;

            status += `\nStatistics:\n`;
            status += `Active Users: ${[...this.userChatSettings.values()].filter(Boolean).length}\n`;
            status += `Active Groups: ${[...this.groupChatSettings.values()].filter(Boolean).length}\n`;
            status += `Active Conversations: ${this.conversations.size}\n`;

            const willRespond = this.shouldRespondToChat(context);
            status += `\nWill I respond to you? ${willRespond ? 'YES' : 'NO'}`;

            return status;
        } catch (error) {
            logger.error('Error in getChatStatus:', error);
            return 'Failed to get chat status. Please try again.';
        }
    }

    async deleteChatHistory(msg, params, context) {
        try {
            const target = params[0];

            if (target === 'all') {
                // Delete all conversation histories
                const result = await this.collection.deleteMany({ type: { $ne: 'personalRole' } });
                this.conversations.clear();
                return `Deleted chat history for all users (${result.deletedCount} records)`;
            } else if (target && /^\d+$/.test(target)) {
                // Delete for specific user
                const userId = target.replace(/[^\d]/g, '');
                const conversationId = `user_${userId}`;
                const result = await this.collection.deleteOne({ conversationId });
                this.conversations.delete(conversationId);
                return `Deleted chat history for +${userId} (${result.deletedCount} records)`;
            } else {
                // Delete for current user/group
                const conversationId = this.getConversationId(context);
                const result = await this.collection.deleteOne({ conversationId });
                this.conversations.delete(conversationId);
                return `Chat history deleted (${result.deletedCount} records)`;
            }
        } catch (error) {
            logger.error('Error in deleteChatHistory:', error);
            return 'Failed to delete chat history. Please try again.';
        }
    }

    async setBotRole(msg, params, context) {
        try {
            if (params.length === 0) {
                return `Current Global Role:\n\n${this.defaultRole}\n\nUsage: .botrole <new_role_description>`;
            }

            const newRole = params.join(' ').trim();
            if (newRole.length < 10) {
                return 'Role description too short. Please provide a more detailed role description (at least 10 characters).';
            }

            this.defaultRole = newRole;
            return `Global Bot Role Updated Successfully`;
        } catch (error) {
            logger.error('Error in setBotRole:', error);
            return 'Failed to update global role. Please try again.';
        }
    }

    async setPersonalRole(msg, params, context) {
        try {
            if (params.length === 0) {
                return `Set Personal Role\n\nUsage: .setrole <role_description> [user_number]\n\nExamples:\n.setrole You are a coding assistant\n.setrole You are a creative writing helper 1234567890`;
            }

            // Check if last parameter is a phone number
            const lastParam = params[params.length - 1];
            let targetUser = null;
            let roleParams = params;

            if (/^\d+$/.test(lastParam)) {
                targetUser = lastParam;
                roleParams = params.slice(0, -1);
            }

            const newRole = roleParams.join(' ').trim();
            if (newRole.length < 10) {
                return 'Role description too short. Please provide a more detailed role description (at least 10 characters).';
            }

            let targetId;
            if (targetUser) {
                // Set role for specific user
                const userId = targetUser.replace(/[^\d]/g, '');
                targetId = `user_${userId}`;
                await this.savePersonalRole(targetId, newRole);
                return `Personal Role Set for +${userId}`;
            } else {
                // Set role for current user/group
                const userId = context.participant.split('@')[0];
                const isGroup = context.sender.endsWith('@g.us');
                targetId = isGroup ? `group_${context.sender}` : `user_${userId}`;
                await this.savePersonalRole(targetId, newRole);
                return `Personal Role Set Successfully`;
            }
        } catch (error) {
            logger.error('Error in setPersonalRole:', error);
            return 'Failed to set personal role. Please try again.';
        }
    }

    async resetPersonalRole(msg, params, context) {
        try {
            const targetUser = params[0];

            if (targetUser && /^\d+$/.test(targetUser)) {
                // Reset role for specific user
                const userId = targetUser.replace(/[^\d]/g, '');
                const targetId = `user_${userId}`;
                await this.removePersonalRole(targetId);
                return `Role Reset for +${userId}`;
            } else {
                // Reset role for current user/group
                const userId = context.participant.split('@')[0];
                const isGroup = context.sender.endsWith('@g.us');
                const targetId = isGroup ? `group_${context.sender}` : `user_${userId}`;
                await this.removePersonalRole(targetId);
                return `Role Reset Successfully`;
            }
        } catch (error) {
            logger.error('Error in resetPersonalRole:', error);
            return 'Failed to reset role. Please try again.';
        }
    }

    async showChatHelp(msg, params, context) {
        try {
            return `ChatBot Help & Features\n\n` +
                    `What I can do:\n` +
                    `- Have natural conversations\n` +
                    `- Remember chat history (${this.maxConversationLength} messages)\n` +
                    `- Process text, images, videos, and audio\n` +
                    `- Answer questions on any topic\n` +
                    `- Help with tasks and problems\n` +
                    `- I am powered by **Gemini AI**\n\n` +
                    `Commands:\n` +
                    `.chat on/off [number] - Toggle for user/group\n` +
                    `.chatall on/off - Global toggle (owner)\n` +
                    `.groupchat on/off - Group toggle (admin)\n` +
                    `.chatstatus - Check current status\n` +
                    `.chatdel [number/all] - Delete chat history\n` +
                    `.setrole <description> [number] - Set custom role\n` +
                    `.resetrole [number] - Reset to default role\n` +
                    `.botrole <description> - Set global role (owner)\n` +
                    `.chathelp - Show this help\n\n` +
                    `Tips:\n` +
                    `- Just type normally to chat with me\n` +
                    `- I remember conversation context\n` +
                    `- Send media (image/video/audio) with text for analysis\n` +
                    `- Use commands to control my behavior`;
        } catch (error) {
            logger.error('Error in showChatHelp:', error);
            return 'Failed to load help information. Please try again.';
        }
    }

    async handleChatMessage(msg, text, bot) {
        // Skip if it's a command
        if (text && text.startsWith(config.get('bot.prefix'))) return;

        const context = {
            sender: msg.key.remoteJid,
            participant: msg.key.participant || msg.key.remoteJid,
            isGroup: msg.key.remoteJid.endsWith('@g.us'),
            fromMe: msg.key.fromMe
        };

        // Skip own messages
        if (context.fromMe) return;

        // Check if chat is enabled for this user/group
        if (!this.shouldRespondToChat(context)) return;

        let typingStarted = false;

        try {
            // Start typing indicator and presence
            if (bot.sock) {
                try {
                    await bot.sock.presenceSubscribe(context.sender);
                    await bot.sock.sendPresenceUpdate('composing', context.sender);
                    typingStarted = true;
                } catch (error) {
                    logger.debug('Failed to set typing indicator:', error.message);
                }
            }

            // Generate response
            const response = await this.generateChatResponse(msg, context, bot);
            
            if (response) {
                // Stop typing before sending message
                if (bot.sock && typingStarted) {
                    try {
                        await bot.sock.sendPresenceUpdate('paused', context.sender);
                    } catch (error) {
                        logger.debug('Failed to stop typing:', error.message);
                    }
                }
                
                // Send response
                const result = await bot.sendMessage(context.sender, { text: response });
                
                // Handle read receipts after successful response
                if (result && bot.sock) {
                    try {
                        await bot.sock.readMessages([msg.key]);
                    } catch (error) {
                        logger.debug('Read receipt failed (non-critical):', error.message);
                    }
                    
                    // Set presence to available after response
                    try {
                        await bot.sock.sendPresenceUpdate('available', context.sender);
                    } catch (error) {
                        logger.debug('Failed to set available presence:', error.message);
                    }
                }
            }

        } catch (error) {
            logger.error('ChatBot response error:', error);
            
            // Always stop typing on error
            if (bot.sock && typingStarted) {
                try {
                    await bot.sock.sendPresenceUpdate('paused', context.sender);
                } catch (err) {
                    logger.debug('Failed to stop typing on error:', err.message);
                }
            }
        }
    }
    shouldRespondToChat(context) {
        const userId = context.participant.split('@')[0];

        // Check global setting first
        if (this.globalChatEnabled) {
            // Check if specifically disabled for this user/group
            if (context.isGroup) {
                return this.groupChatSettings.get(context.sender) !== false;
            } else {
                return this.userChatSettings.get(userId) !== false;
            }
        } else {
            // Check if specifically enabled for this user/group
            if (context.isGroup) {
                return this.groupChatSettings.get(context.sender) === true;
            } else {
                return this.userChatSettings.get(userId) === true;
            }
        }
    }

    async generateChatResponse(msg, context, bot) {
        try {
            const conversationId = this.getConversationId(context);
            const history = await this.getConversationHistory(conversationId);
            
            // Get the appropriate role (personal or default)
            const userId = context.participant.split('@')[0];
            const isGroup = context.isGroup;
            const targetId = isGroup ? `group_${context.sender}` : `user_${userId}`;
            const personalRole = await this.getPersonalRole(targetId);
            const currentRole = personalRole || this.defaultRole;
            
            // Build context-aware prompt with timestamp
            const timestamp = new Date().toISOString();
            let textPrompt = `${currentRole}\n\nCurrent timestamp: ${timestamp}\n\n`;
            
            // Add conversation history
            if (history.length > 0) {
                textPrompt += 'Previous conversation:\n';
                history.forEach(entry => {
                    const historyTime = new Date(entry.timestamp).toISOString();
                    textPrompt += `[${historyTime}] User: ${entry.user}\n`;
                    textPrompt += `[${historyTime}] Assistant: ${entry.assistant}\n\n`;
                });
            }
            
            const { text: userText, media: mediaParts } = await this.extractMessageContent(msg, bot);
            
            // Add current message text to the prompt
            textPrompt += `Current message [${timestamp}]: ${userText || ''}`;

            const promptParts = [textPrompt, ...mediaParts];
            
            const result = await this.model.generateContent(promptParts);
            const response = await result.response;
            const aiResponse = response.text();

            // Update conversation history in database with the text part of the user's message
            await this.addToConversation(conversationId, userText, aiResponse);

            return aiResponse;

        } catch (error) {
            logger.error('Error generating chat response:', error);
            if (error.message.includes('400 Bad Request')) {
                return "I'm sorry, the media could not be processed. It might be in an unsupported format or too large.";
            }
            return 'Sorry, I encountered an error generating a response. Please try again.';
        }
    }

    async extractMessageContent(msg, bot) {
        try {
            const mediaParts = [];
            // Handle text messages and captions
            const text = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         msg.message?.imageMessage?.caption || 
                         msg.message?.videoMessage?.caption || 
                         msg.message?.audioMessage?.caption ||
                         msg.message?.documentMessage?.caption || '';

            // Handle different media types
            if (msg.message?.imageMessage) {
                try {
                    const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    
                    mediaParts.push({
                        inlineData: {
                            data: buffer.toString('base64'),
                            mimeType: msg.message.imageMessage.mimetype,
                        },
                    });

                } catch (e) {
                    logger.error("Failed to download or process image:", e);
                    return { text: text + "\n[Error processing attached image]", media: [] };
                }
            } else if (msg.message?.videoMessage) {
                try {
                    const stream = await downloadContentFromMessage(msg.message.videoMessage, 'video');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    
                    mediaParts.push({
                        inlineData: {
                            data: buffer.toString('base64'),
                            mimeType: msg.message.videoMessage.mimetype || 'video/mp4',
                        },
                    });

                } catch (e) {
                    logger.error("Failed to download or process video:", e);
                    return { text: text + '\n[Error processing attached video]', media: [] };
                }
            } else if (msg.message?.audioMessage) {
                try {
                    const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    
                    mediaParts.push({
                        inlineData: {
                            data: buffer.toString('base64'),
                            mimeType: msg.message.audioMessage.mimetype || 'audio/ogg',
                        },
                    });

                } catch (e) {
                    logger.error("Failed to download or process audio:", e);
                    return { text: text + '\n[Error processing attached audio]', media: [] };
                }
            } else if (msg.message?.documentMessage) {
                const docName = msg.message.documentMessage.fileName || 'Unknown document';
                return { text: text ? `${text}\n[Document attached: ${docName}]` : `[Document attached: ${docName}]`, media: [] };
            } else if (msg.message?.stickerMessage) {
                return { text: '[Sticker sent]', media: [] };
            } else if (msg.message?.locationMessage) {
                return { text: '[Location shared]', media: [] };
            } else if (msg.message?.contactMessage) {
                return { text: '[Contact shared]', media: [] };
            }

            return { text, media: mediaParts };
        } catch (error) {
            logger.error('Error extracting message content:', error);
            return { text: '[Error processing message]', media: [] };
        }
    }

    getConversationId(context) {
        if (context.isGroup) {
            return `group_${context.sender}`;
        } else {
            return `user_${context.participant.split('@')[0]}`;
        }
    }

    async getConversationHistory(conversationId) {
        try {
            const data = await this.collection.findOne({ conversationId });
            return data ? data.history : [];
        } catch (error) {
            logger.error('Error getting conversation history:', error);
            return [];
        }
    }

    async addToConversation(conversationId, userMessage, aiResponse) {
        try {
            const data = await this.collection.findOne({ conversationId });
            let history = data ? data.history : [];
            
            history.push({
                user: userMessage,
                assistant: aiResponse,
                timestamp: Date.now()
            });

            // Keep only recent messages
            if (history.length > this.maxConversationLength) {
                history = history.slice(-this.maxConversationLength);
            }

            await this.collection.updateOne(
                { conversationId },
                { 
                    $set: { 
                        history, 
                        updatedAt: new Date() 
                    } 
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Error adding to conversation:', error);
        }
    }

    // Database helper methods for personal roles
    async savePersonalRole(targetId, role) {
        try {
            await this.collection.updateOne(
                { targetId, type: 'personalRole' },
                { 
                    $set: { 
                        role, 
                        updatedAt: new Date() 
                    } 
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Error saving personal role:', error);
            throw error;
        }
    }

    async getPersonalRole(targetId) {
        try {
            const data = await this.collection.findOne({ targetId, type: 'personalRole' });
            return data ? data.role : null;
        } catch (error) {
            logger.error('Error getting personal role:', error);
            return null;
        }
    }

    async removePersonalRole(targetId) {
        try {
            await this.collection.deleteOne({ targetId, type: 'personalRole' });
        } catch (error) {
            logger.error('Error removing personal role:', error);
            throw error;
        }
    }


}

export default ChatBotModule;
