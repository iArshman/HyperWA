const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger');
const config = require('../config');
const helpers = require('../utils/helpers');
// Temporary in-memory store; replace with DB for persistence
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
        // Load Module Command
        const loadModuleCommand = {
            name: 'lm',
            description: 'Load a module from file',
            usage: '.lm (reply to a .js or .mjs file)',
            permissions: 'owner',
            execute: async (msg, params, context) => {
                const fileName = msg.message?.documentMessage?.fileName;
                if (!fileName || (!fileName.endsWith('.js') && !fileName.endsWith('.mjs'))) {
                    return context.bot.sendMessage(context.sender, {
                        text: '🔧 *Load Module*\n\n❌ Please reply to a JavaScript (.js or .mjs) file to load it as a module.'
                    });
                }

                try {
                    const processingMsg = await context.bot.sendMessage(context.sender, {
                        text: '⚡ *Loading Module*\n\n🔄 Downloading and installing module...\n⏳ Please wait...'
                    });

                    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                    const stream = await downloadContentFromMessage(msg.message.documentMessage, 'document');
                    
                    const chunks = [];
                    for await (const chunk of stream) {
                        chunks.push(chunk);
                    }
                    const buffer = Buffer.concat(chunks);
                    
                    const fileName = msg.message.documentMessage.fileName;
                    const customModulesPath = path.join(__dirname, '../custom_modules');
                    await fs.ensureDir(customModulesPath);
                    
                    const filePath = path.join(customModulesPath, fileName);
                    await fs.writeFile(filePath, buffer);
                    
                    await this.loadModule(filePath, false);
                    
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

        // Unload Module Command
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

        // List Modules Command
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

        // Register module management commands
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


        // Load help system after all modules
        this.setupHelpSystem();

    }



setupHelpSystem() {
    const helpPreferences = new Map();

    const getUserPermissions = (userId) => {
        const owner = config.get('bot.owner')?.split('@')[0]; // Get owner ID without domain
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
        const userId = context.sender.split('@')[0]; // Normalize userId
        const userPerms = getUserPermissions(userId);

        const helpConfig = config.get('help') || {};
        const defaultStyle = helpConfig.defaultStyle || 1;
        const defaultShow = helpConfig.defaultShow || 'description';
        const pref = helpPreferences.get(userId) || { style: defaultStyle, show: defaultShow };

            // Handle `.help 1` / `.help 2` (style switch)
            if (params.length === 1 && ['1', '2'].includes(params[0])) {
                pref.style = Number(params[0]);
                helpPreferences.set(userId, pref);
                await context.bot.sendMessage(context.sender, {
                    text: `✅ Help style set to *${pref.style}*`
                });
                return;
            }

            // Handle `.help show 1|2|3`
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

            // Handle `.help [module]`
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

            // Render all modules
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
            delete require.cache[require.resolve(filePath)];
            const mod = require(filePath);

            const moduleInstance = typeof mod === 'function' && /^\s*class\s/.test(mod.toString()) 
                                   ? new mod(this.bot) 
                                   : mod;

            const actualModuleId = (moduleInstance && moduleInstance.name) ? moduleInstance.name : moduleId;

            // Validate module structure
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

                    // Only wrap commands that have UI config (structured modules)
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
} : cmd; // Use original command without wrapping


                    this.bot.messageHandler.registerCommandHandler(cmd.name, wrappedCmd);

                    // Register aliases if they exist
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

        if (moduleInfo.instance.destroy && typeof moduleInfo.instance.destroy === 'function') {
            await moduleInfo.instance.destroy();
        }

        if (Array.isArray(moduleInfo.instance.commands)) {
            for (const cmd of moduleInfo.instance.commands) {
                if (cmd.name) {
                    this.bot.messageHandler.unregisterCommandHandler(cmd.name);
                }
            }
        }
        if (moduleInfo.instance.messageHooks && typeof moduleInfo.instance.messageHooks === 'object') {
            for (const hook of Object.keys(moduleInfo.instance.messageHooks)) {
                this.bot.messageHandler.unregisterMessageHook(hook);
            }
        }

        this.modules.delete(moduleId);
        delete require.cache[moduleInfo.path];
        logger.info(`🚫 Unloaded module: ${moduleId}`);
    }
}

module.exports = ModuleLoader;
