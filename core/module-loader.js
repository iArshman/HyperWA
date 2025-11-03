import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import config from '../config.js';
import helpers from '../utils/helpers.js';

// ES Module equivalent for __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const helpPreferences = new Map();

class ModuleLoader {
    constructor(bot) {
        this.bot = bot;
        this.modules = new Map();
        this.systemModulesCount = 0;
        this.customModulesCount = 0;
        this.setupModuleCommands();

    }

    setupModuleCommands() {
        const loadModuleCommand = {
    name: 'lm',
    description: 'Load a module from file',
    usage: '.lm (reply to a .js or .mjs file)',
    permissions: 'owner',
    execute: async (msg, params, context) => {
        try {
            // Get the quoted message (if user replied to a file)
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const docMsg = msg.message?.documentMessage || quoted?.documentMessage;

            if (!docMsg) {
                return context.bot.sendMessage(context.sender, {
                    text: '🔧 *Load Module*\n\n❌ Please reply to or send a JavaScript (.js, .mjs, or .ejs) file to load it as a module.'
                });
            }

            // Try to get filename and MIME type
            let fileName = docMsg?.fileName || 'module.js';
            const mime = docMsg?.mimetype || '';

            // If WhatsApp stripped file name, generate one
            if (!fileName || fileName === 'unknown') {
                if (mime.includes('javascript')) fileName = `module_${Date.now()}.js`;
                else fileName = `custom_${Date.now()}.js`;
            }

            // Accept only JS-based extensions
            if (!fileName.endsWith('.js') && !fileName.endsWith('.mjs') && !fileName.endsWith('.ejs')) {
                return context.bot.sendMessage(context.sender, {
                    text: '🔧 *Load Module*\n\n❌ Please reply to or send a JavaScript (.js, .mjs, or .ejs) file to load it as a module.'
                });
            }

            // Normalize `.ejs` to `.js`
            if (fileName.endsWith('.ejs')) {
                fileName = fileName.replace(/\.ejs$/, '.js');
            }

            // Notify user that it's working
            const processingMsg = await context.bot.sendMessage(context.sender, {
                text: '⚡ *Loading Module*\n\n🔄 Downloading and installing module...\n⏳ Please wait...'
            });

            // Import Baileys utility dynamically
            const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
            const stream = await downloadContentFromMessage(docMsg, 'document');

            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            // Save the file in custom_modules folder
            const customModulesPath = path.join(__dirname, '../custom_modules');
            await fs.ensureDir(customModulesPath);

            const filePath = path.join(customModulesPath, fileName);
            await fs.writeFile(filePath, buffer);

            // Load the module dynamically
            await this.loadModule(filePath, false);

            // Notify success
            await context.bot.sock.sendMessage(context.sender, {
                text: `✅ *Module Loaded Successfully*\n\n📦 Module: \`${fileName}\`\n📁 Location: Custom Modules\n🎯 Status: Active\n⏰ ${new Date().toLocaleTimeString()}`,
                edit: processingMsg.key
            });

        } catch (error) {
            logger.error('Failed to load module:', error);
            await context.bot.sendMessage(context.sender, {
                text: `❌ *Module Load Failed*\n\n🚫 Error: ${error.message}\n🔧 Please check the module file format.`
            });
        }
    }
};


        const unloadModuleCommand = {
            name: 'ulm',
            description: 'Unload a module',
            usage: '.ulm <module_name>',
            permissions: 'owner',
            execute: async (msg, params, context) => {
                if (params.length === 0) {
                    const moduleList = this.listModules().join('\n• ');
                    return context.bot.sendMessage(context.sender, {
                        text: `🔧 *Unload Module*\n\n📋 Available modules:\n• ${moduleList}\n\n💡 Usage: \`.ulm <module_name>\``
                    });
                }

                const moduleName = params[0];

                try {
                    const processingMsg = await context.bot.sendMessage(context.sender, {
                        text: `⚡ *Unloading Module*\n\n🔄 Removing: \`${moduleName}\`\n⏳ Please wait...`
                    });

                    await this.unloadModule(moduleName);

                    await context.bot.sock.sendMessage(context.sender, {
                        text: `✅ *Module Unloaded Successfully*\n\n📦 Module: \`${moduleName}\`\n🗑️ Status: Removed\n⏰ ${new Date().toLocaleTimeString()}`,
                        edit: processingMsg.key
                    });

                } catch (error) {
                    logger.error('Failed to unload module:', error);
                    await context.bot.sendMessage(context.sender, {
                        text: `❌ *Module Unload Failed*\n\n🚫 Error: ${error.message}\n📦 Module: \`${moduleName}\``
                    });
                }
            }
        };

        const listModulesCommand = {
            name: 'modules',
            description: 'List all loaded modules',
            usage: '.modules',
            permissions: 'public',
            execute: async (msg, params, context) => {
                const systemModules = [];
                const customModules = [];

                for (const [name, moduleInfo] of this.modules) {
                    if (moduleInfo.isSystem) {
                        systemModules.push(name);
                    } else {
                        customModules.push(name);
                    }
                }

                let moduleText = `🔧 *Loaded Modules*\n\n`;
                moduleText += `📊 **System Modules (${systemModules.length}):**\n`;
                if (systemModules.length > 0) {
                    moduleText += `• ${systemModules.join('\n• ')}\n\n`;
                } else {
                    moduleText += `• None loaded\n\n`;
                }

                moduleText += `🎨 **Custom Modules (${customModules.length}):**\n`;
                if (customModules.length > 0) {
                    moduleText += `• ${customModules.join('\n• ')}\n\n`;
                } else {
                    moduleText += `• None loaded\n\n`;
                }

                moduleText += `📈 **Total:** ${this.modules.size} modules active`;

                await context.bot.sendMessage(context.sender, { text: moduleText });
            }
        };

        this.bot.messageHandler.registerCommandHandler('lm', loadModuleCommand);
        this.bot.messageHandler.registerCommandHandler('ulm', unloadModuleCommand);
        this.bot.messageHandler.registerCommandHandler('modules', listModulesCommand);
    }

async loadModules() {
    const systemPath = path.join(__dirname, '../modules');
    const customPath = path.join(__dirname, '../modules/custom_modules');

    await fs.ensureDir(systemPath);
    await fs.ensureDir(customPath);

    const [systemFiles, customFiles] = await Promise.all([
        fs.readdir(systemPath),
        fs.readdir(customPath)
    ]);

    this.systemModulesCount = 0;
    this.customModulesCount = 0;

    for (const file of systemFiles) {
        if (file.endsWith('.js')) {
            await this.loadModule(path.join(systemPath, file), true);
        }
    }

    for (const file of customFiles) {
        if (file.endsWith('.js')) {
            await this.loadModule(path.join(customPath, file), false);
        }
    }
logger.info(`Modules Loaded || 🧩 System: ${this.systemModulesCount} || 📦 Custom: ${this.customModulesCount} || 📊 Total: ${this.systemModulesCount + this.customModulesCount}`);


        this.setupHelpSystem();

    }



setupHelpSystem() {
    const helpPreferences = new Map();

    const getUserPermissions = (userId) => {
        const owner = config.get('bot.owner')?.split('@')[0];
        const isOwner = owner === userId;
        const admins = config.get('bot.admins') || [];
        const isAdmin = admins.includes(userId);
        return isOwner ? ['public', 'admin', 'owner'] : isAdmin ? ['public', 'admin'] : ['public'];
    };

    const helpCommand = {
        name: 'help',
        description: 'Show available commands or help for a module',
        usage: '.help [module_name] | .help 1|2 | .help show 1|2|3',
        permissions: 'public',
        execute: async (msg, params, context) => {
        const userId = msg.key.fromMe 
        ? config.get('bot.owner').split('@')[0] 
        : (msg.key.participant || msg.key.remoteJid || context.sender).split('@')[0];
            
        const userPerms = getUserPermissions(userId);

        const helpConfig = config.get('help') || {};
        const defaultStyle = helpConfig.defaultStyle || 1;
        const defaultShow = helpConfig.defaultShow || 'description';
        const pref = helpPreferences.get(userId) || { style: defaultStyle, show: defaultShow };

            if (params.length === 1 && ['1', '2'].includes(params[0])) {
                pref.style = Number(params[0]);
                helpPreferences.set(userId, pref);
                await context.bot.sendMessage(context.sender, {
                    text: `✅ Help style set to *${pref.style}*`
                });
                return;
            }

            if (params.length === 2 && params[0] === 'show') {
                const map = { '1': 'description', '2': 'usage', '3': 'none' };
                if (!map[params[1]]) {
                    return await context.bot.sendMessage(context.sender, {
                        text: `❌ Invalid show option.\nUse:\n.help show 1 (description)\n.help show 2 (usage)\n.help show 3 (none)`
                    });
                }
                pref.show = map[params[1]];
                helpPreferences.set(userId, pref);
                return await context.bot.sendMessage(context.sender, {
                    text: `✅ Help display mode set to *${pref.show}*`
                });
            }

            if (params.length === 1) {
                const moduleName = params[0].toLowerCase();
                const moduleInfo = this.getModule(moduleName);

                if (!moduleInfo) {
                    return await context.bot.sendMessage(context.sender, {
                        text: `❌ Module *${moduleName}* not found.\nUse *.help* to view available modules.`
                    });
                }

                const commands = Array.isArray(moduleInfo.commands) ? moduleInfo.commands : [];

                const visibleCommands = commands.filter(cmd => {
                    const perms = Array.isArray(cmd.permissions) ? cmd.permissions : [cmd.permissions];
                    return perms.some(p => userPerms.includes(p));
                });

                let out = '';
                if (pref.style === 2) {
                    out += `██▓▒░ *${moduleName}*\n\n`;
                    for (const cmd of visibleCommands) {
                        const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                        if (pref.show === 'none') {
                            out += `  ↳ *${cmd.name}*\n`;
                        } else {
                            out += `  ↳ *${cmd.name}*: ${info}\n`;
                        }
                    }
                } else {
                    out += `╔══  *${moduleName}* ══\n`;
                    for (const cmd of visibleCommands) {
                        const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                        if (pref.show === 'none') {
                            out += `║ *${cmd.name}*\n`;
                        } else {
                            out += `║ *${cmd.name}* – ${info}\n`;
                        }
                    }
                    out += `╚═══════════════`;
                }

                return await context.bot.sendMessage(context.sender, { text: out });
            }

            const systemModules = [];
            const customModules = [];

            for (const [name, moduleInfo] of this.modules) {
                const entry = { name, instance: moduleInfo.instance };
                moduleInfo.isSystem ? systemModules.push(entry) : customModules.push(entry);
            }

            const renderModuleBlock = (modules) => {
                let block = '';
                for (const mod of modules) {
                    const commands = Array.isArray(mod.instance.commands) ? mod.instance.commands : [];
                    const visible = commands.filter(c => {
                        const perms = Array.isArray(c.permissions) ? c.permissions : [c.permissions];
                        return perms.some(p => userPerms.includes(p));
                    });
                    if (visible.length === 0) continue;

                    if (pref.style === 2) {
                        block += `██▓▒░ *${mod.name}*\n\n`;
                        for (const cmd of visible) {
                            const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                            if (pref.show === 'none') {
                                block += `  ↳ *${cmd.name}*\n`;
                            } else {
                                block += `  ↳ *${cmd.name}*: ${info}\n`;
                            }
                        }
                        block += `\n`;
                    } else {
                        block += `╔══  *${mod.name}* ══\n`;
                        for (const cmd of visible) {
                            const info = pref.show === 'usage' ? cmd.usage : cmd.description;
                            if (pref.show === 'none') {
                                block += `║ *${cmd.name}*\n`;
                            } else {
                                block += `║ *${cmd.name}* – ${info}\n`;
                            }
                        }
                        block += `╚═══════════════\n\n`;
                    }
                }
                return block;
            };
            let helpText = `🤖 *${config.get('bot.name')} Help Menu*\n\n`;
helpText += renderModuleBlock(systemModules);
helpText += renderModuleBlock(customModules);
await context.bot.sendMessage(context.sender, { text: helpText.trim() });

        }
    };

    this.bot.messageHandler.registerCommandHandler('help', helpCommand);
}

    getCommandModule(commandName) {
        for (const [moduleName, moduleInfo] of this.modules) {
            if (moduleInfo.instance.commands) {
                for (const cmd of moduleInfo.instance.commands) {
                    if (cmd.name === commandName) {
                        return moduleName;
                    }
                }
            }
        }
        return 'Core System';
    }

    async loadModule(filePath, isSystem) {
        const moduleId = path.basename(filePath, '.js');

        try {
            // Convert local file path to a URL for dynamic import
            // Use a cache-busting parameter to force reload the module file
            const moduleUrl = new URL(`file://${filePath}?update=${Date.now()}`); 
            
            const mod = await import(moduleUrl.href);

            // Access the default export for class or object
            const moduleInstance = typeof mod.default === 'function' && /^\s*class\s/.test(mod.default.toString())
                                   ? new mod.default(this.bot)
                                   : (mod.default || mod);

            const actualModuleId = (moduleInstance && moduleInstance.name) ? moduleInstance.name : moduleId;

            if (!moduleInstance.metadata) {
                moduleInstance.metadata = {
                    description: 'No description provided',
                    version: 'Unknown',
                    author: 'Unknown',
                    category: 'Uncategorized',
                    dependencies: []
                };
            }

            if (moduleInstance.init && typeof moduleInstance.init === 'function') {
                await moduleInstance.init();
            }

            if (Array.isArray(moduleInstance.commands)) {
                for (const cmd of moduleInstance.commands) {
    if (!cmd.name || !cmd.description || !cmd.usage || !cmd.execute) {
        logger.warn(`⚠️ Invalid command in module ${actualModuleId}: ${JSON.stringify(cmd)}`);
        continue;
    }

                    const ui = cmd.ui || {};

const shouldWrap = cmd.ui && (cmd.autoWrap !== false);
const wrappedCmd = shouldWrap ? {
    ...cmd,
    execute: async (msg, params, context) => {
        await helpers.smartErrorRespond(context.bot, msg, {
            processingText: ui.processingText || `⏳ Running *${cmd.name}*...`,
            errorText: ui.errorText || `❌ *${cmd.name}* failed.`,
            actionFn: async () => {
                return await cmd.execute(msg, params, context);
            }
        });
    }
} : cmd;


                    this.bot.messageHandler.registerCommandHandler(cmd.name, wrappedCmd);

                    if (cmd.aliases && Array.isArray(cmd.aliases)) {
                        for (const alias of cmd.aliases) {
                            if (alias && typeof alias === 'string') {
                                this.bot.messageHandler.registerCommandHandler(alias, wrappedCmd);
                                logger.debug(`📝 Registered alias: ${alias} -> ${cmd.name}`);
                            }
                        }
                    }
                }
            }
            if (moduleInstance.messageHooks && typeof moduleInstance.messageHooks === 'object' && moduleInstance.messageHooks !== null) {
                for (const [hook, fn] of Object.entries(moduleInstance.messageHooks)) {
                    this.bot.messageHandler.registerMessageHook(hook, fn.bind(moduleInstance));
                }
            }

            this.modules.set(actualModuleId, {
                instance: moduleInstance,
                path: filePath,
                isSystem
            });

            if (isSystem) {
                this.systemModulesCount++;
            } else {
                this.customModulesCount++;
            }

} catch (err) {
    logger.error(`❌ Failed to load module '${moduleId}' from ${filePath}`);
    logger.error(`Error message: ${err.message}`);

}

    }

    getModule(name) {
        return this.modules.get(name)?.instance || null;
    }

    listModules() {
        return [...this.modules.keys()];
    }

    async unloadModule(moduleId) {
        const moduleInfo = this.modules.get(moduleId);
        if (!moduleInfo) {
            throw new Error(`Module ${moduleId} not found`);
        }
        
        // Fix: Declare moduleInstance from moduleInfo
        const moduleInstance = moduleInfo.instance;

        if (moduleInstance.destroy && typeof moduleInstance.destroy === 'function') {
            await moduleInstance.destroy();
        }

        if (Array.isArray(moduleInstance.commands)) {
            for (const cmd of moduleInstance.commands) {
                if (cmd.name) {
                    this.bot.messageHandler.unregisterCommandHandler(cmd.name);
                }
            }
        }
        // Use moduleInstance here
        if (moduleInstance.messageHooks && typeof moduleInstance.messageHooks === 'object') {
            for (const hook of Object.keys(moduleInstance.messageHooks)) {
                this.bot.messageHandler.unregisterMessageHook(hook);
            }
        }

        this.modules.delete(moduleId);
        logger.info(`🚫 Unloaded module: ${moduleId}`);
    }
}

export default ModuleLoader;
