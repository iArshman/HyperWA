import { HyperWaBot } from './core/bot.js';
import logger from './core/logger.js';
import config from './config.js';
import * as crypto from 'crypto';


async function main() {
    try {
        logger.info('🚀 Starting HyperWa Userbot...');
        logger.info(`🎯 Version: ${config.get('bot.version')}`);
        logger.info(`🏢 Company: ${config.get('bot.company')}`);

        const bot = new HyperWaBot();
        await bot.initialize();

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('🛑 Received SIGINT, shutting down gracefully...');
            await bot.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('🛑 Received SIGTERM, shutting down gracefully...');
            await bot.shutdown();
            process.exit(0);
        });

        // Better error logging
        process.on('uncaughtException', (error) => {
            logger.error({ err: error }, '💥 Uncaught Exception');
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error({ err: reason }, '💥 Unhandled Rejection at:', promise);
            process.exit(1);
        });

    } catch (error) {
        // ✅ Fixed: Now logs full error with stack
        logger.error({ err: error }, '💥 Failed to start HyperWa Userbot');
        process.exit(1);
    }
}

// Startup banner
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    ██╗  ██╗██╗   ██╗██████╗ ███████╗██████╗ ██╗      ██╗ █████╗ ║
║    ██║  ██║╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗██║      ██║██╔══██╗║
║    ███████║ ╚████╔╝ ██████╔╝█████╗  ██████╔╝██║ █╗ ██║███████║║
║    ██╔══██║  ╚██╔╝  ██╔═══╝ ██╔══╝  ██╔══██╗██║███╗██║██╔══██║║
║    ██║  ██║   ██║  ██║      ███████╗██║  ██║╚███╔███╔╝██║  ██║║
║    ╚═╝  ╚═╝   ╚═╝  ╚═╝      ╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚═╝  ╚═╝║
║                                                              ║
║            Advanced WhatsApp Userbot                         ║
║              Version 3.0.0                                   ║
║              Dawium Technologies                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

main();
