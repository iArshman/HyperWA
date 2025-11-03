# HyperWa - Advanced WhatsApp Userbot 🚀


A powerful, modular WhatsApp userbot built with Baileys, featuring Telegram integration, AI capabilities, and extensive customization options.

---

## ✨ Features

### Core Features
- **Modular Architecture** - Easy-to-extend plugin system
- **Telegram Bridge** - Bidirectional messaging between WhatsApp and Telegram
- **MongoDB Integration** - Persistent storage with authentication state backup
- **Enhanced Store System** - Advanced message history and contact management
- **AI-Powered Chat** - Gemini AI integration with conversation memory
- **Rate Limiting** - Built-in command throttling
- **Auto-Reply & Status Viewing** - Automated message responses and status monitoring
- **Media Processing** - Image, video, and audio conversion tools
- **Group Management** - Complete admin toolkit
- **Weather & Translation** - Real-time weather data and multi-language translation

### Advanced Features
- **Custom Module Loading** - Load JavaScript modules on-the-fly
- **Database-Backed Settings** - Per-user and per-group configurations
- **File & Media Analysis** - Detailed information extraction
- **Social Media Downloads** - TikTok, Instagram, Twitter, Facebook support
- **Music Downloads** - YouTube and Spotify audio extraction
- **Vision AI** - Image and video analysis with Gemini Vision
- **Smart Error Handling** - User-friendly error responses with auto-editing

---
##  Telegram Bridge Features

### QR Code Sharing
- Automatically sends WhatsApp QR codes to Telegram
- Easy scanning without terminal access
- Supports reconnection QR codes

### Message Syncing
- All WhatsApp messages sync to Telegram topics
- Media files are forwarded
- Contact information is preserved
- Status updates are synced

### Bidirectional Communication
- Send messages from Telegram to WhatsApp
- Reply to WhatsApp messages via Telegram
- Media forwarding in both directions

## 📊 Database Collections

### Bridge Data
```javascript
// Chat mappings
{
    type: 'chat',
    data: {
        whatsappJid: '1234567890@s.whatsapp.net',
        telegramTopicId: 123,
        createdAt: Date,
        lastActivity: Date
    }
}

// User mappings
{
    type: 'user',
    data: {
        whatsappId: '1234567890@s.whatsapp.net',
        name: 'John Doe',
        phone: '1234567890',
        firstSeen: Date,
        messageCount: 42
    }
}

// Contact mappings
{
    type: 'contact',
    data: {
        phone: '1234567890',
        name: 'John Doe',
        updatedAt: Date
    }
}
```

## Available Commands

### Core Commands
- `.ping` - Check bot latency
- `.status` - Show bot statistics
- `.help` - Show all commands
- `.modules` - List loaded modules
- `.restart` - Restart bot (owner)
- `.mode` - Toggle public/private mode

### Module Management
- `.lm` - Load module (reply to .js file)
- `.ulm <name>` - Unload module
- `.modules` - List all modules

### AI Features
- `.ai <message>` - Chat with Gemini
- `.chat on/off` - Toggle chatbot
- `.explain <topic>` - Get explanations
- `.code <question>` - Coding help
- `.describe` - Analyze image/video (reply to media)
- `.ocr` - Extract text from media

### Media Tools
- `.sticker` - Create sticker from image
- `.toimg` - Convert sticker to image
- `.tovn` - Convert to voice note
- `.tomp3` - Convert to MP3
- `.rvo` - Reveal view-once media

### Downloads
- `.tiktok <url>` - Download TikTok video
- `.instagram <url>` - Download Instagram content
- `.twitter <url>` - Download Twitter media
- `.spotify <url>` - Download Spotify track
- `.yt <url>` - Download YouTube video
- `.ytmp3 <url>` - Download YouTube audio

### Utilities
- `.weather [city]` - Get weather info
- `.tr <text>` - Translate text
- `.time [city]` - Get current time
- `.fileinfo` - Get file information (reply to media)

### Group Management
- `.promote` - Promote to admin
- `.demote` - Demote from admin
- `.kick` - Remove member
- `.mute` - Mute group
- `.groupinfo` - Show group info
- `.admins` - List admins

---
## Installation

### Prerequisites
- Node.js 18+ (Node 22 recommended)
- MongoDB instance
- Docker (optional)
- FFmpeg (required for media processing)

### Quick Start

1. **Clone the repository**
```bash
git clone <repository-url>
cd HyperWa
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure the bot**

Edit `config.js` to set your preferences:
```javascript
bot: {
    name: 'HyperWa',
    prefix: '.',
    owner: 'YOUR_NUMBER@s.whatsapp.net'
}
```

4. **Set up MongoDB**

Update MongoDB credentials in `config.js`:
```javascript
mongo: {
    uri: 'mongodb+srv://user:pass@cluster.mongodb.net/',
    dbName: 'YourDBName'
}
```

5. **Start the bot**
```bash
npm start
```

Scan the QR code with WhatsApp to authenticate.

---

## Docker Deployment

### Using Docker

1. **Build the image**
```bash
docker build -t hyperwa-bot .
```

2. **Run the container**
```bash
docker run -d \
  --name hyperwa \
  --restart unless-stopped \
  -v $(pwd)/auth_info:/app/auth_info \
  hyperwa-bot
```

### Environment Variables

The bot uses in-memory configuration by default. For production, consider using environment variables or a config file mounted into the container.

---

## Configuration Guide

### Basic Configuration

The `config.js` file contains all bot settings:

```javascript
{
    bot: {
        name: 'HyperWa',           // Bot display name
        prefix: '.',                // Command prefix
        owner: '1234567890@s.whatsapp.net',  // Owner JID
        clearAuthOnStart: false     // Clear auth on startup
    },

    features: {
        mode: 'private',            // 'private' or 'public'
        customModules: true,        // Enable custom module loading
        rateLimiting: true,         // Enable rate limiting
        autoReply: false,           // Auto-reply to messages
        autoViewStatus: false,      // Auto-view WhatsApp statuses
        telegramBridge: true        // Enable Telegram integration
    },

    telegram: {
        enabled: true,
        botToken: 'YOUR_BOT_TOKEN',
        chatId: '-1002846269080'   // Main bridge chat ID
    }
}
```

### Authentication Methods

HyperWa supports two authentication methods:

1. **File-based (Default)**
   - Stores credentials in `./auth_info/`
   - Fast and simple
   - Not recommended for distributed deployments

2. **MongoDB-based**
   - Stores credentials in MongoDB as tar archive
   - Persistent across deployments
   - Enable in `config.js`:
   ```javascript
   auth: {
       useMongoAuth: true
   }
   ```

---
## Telegram Integration

### Setup

1. **Create a Telegram bot** with [@BotFather](https://t.me/BotFather)
2. **Get your bot token** from BotFather
3. **Create a private group/channel** for the bridge
4. **Get the chat ID** (use [@userinfobot](https://t.me/userinfobot))
5. **Update config.js**:

```javascript
telegram: {
    enabled: true,
    botToken: '8340169817:AAE3p5yc0uSg-FOZMirWVu9sj9x4Jp8CCug',
    botPassword: '1122',  // Password to access bridge
    chatId: '-1002846269080',  // Main bridge chat
    features: {
        topics: true,           // Use topics for organization
        mediaSync: true,        // Sync images/videos
        profilePicSync: false,  // Sync profile pictures
        callLogs: true,         // Log incoming calls
        statusSync: true,       // Sync status updates
        biDirectional: true     // Enable TG -> WA messaging
    }
}
```

### Telegram Commands

Once configured, use these commands in your Telegram bridge:

- `/start` - Show bot info
- `/status` - Show bridge status
- `/send <number> <message>` - Send WhatsApp message
- `/sync` - Sync WhatsApp contacts
- `/searchcontact <name>` - Search contacts
- `/addfilter <word>` - Block messages starting with word
- `/filters` - Show current filters
- `/clearfilters` - Remove all filters

---

## API Keys Configuration

Several modules require API keys. Update these in their respective module files:

### Gemini AI (chatbot.js, gvision.js, gemini.js)
```javascript
this.apiKey = "YOUR_GEMINI_API_KEY";
```
Get from: https://makersuite.google.com/app/apikey

### Weather Module (weather.js)
```javascript
this.apiKey = "YOUR_OPENWEATHERMAP_KEY";
```
Get from: https://openweathermap.org/api

### Time Module (time.js)
```javascript
this.geoApiUsername = "YOUR_GEONAMES_USERNAME";
this.weatherApiKey = "YOUR_OPENWEATHERMAP_KEY";  // Optional
```
Get from: https://www.geonames.org/

---



## Module Development

### Creating a Custom Module

Modules follow a simple structure. Create a new file in `modules/` or `modules/custom_modules/`:

```javascript
class MyModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'mymodule';
        this.metadata = {
            description: 'My custom module',
            version: '1.0.0',
            author: 'Your Name',
            category: 'utility'
        };

        this.commands = [
            {
                name: 'mycommand',
                description: 'Does something cool',
                usage: '.mycommand <args>',
                permissions: 'public', // 'public', 'admin', 'owner'
                aliases: ['mc', 'mycmd'],
                ui: {
                    processingText: 'Processing...',
                    errorText: 'Command failed'
                },
                execute: this.handleCommand.bind(this)
            }
        ];
    }

    async init() {
        // Optional: Called when module loads
        console.log('MyModule initialized');
    }

    async handleCommand(msg, params, context) {
        // msg: Baileys message object
        // params: Array of command arguments
        // context: { bot, sender, participant, isGroup }

        return `Hello! You sent: ${params.join(' ')}`;
    }

    async destroy() {
        // Optional: Called when module unloads
        console.log('MyModule destroyed');
    }
}

export default MyModule;
```

### Command Permissions

- **public**: Anyone can use
- **admin**: Bot admins + owner
- **owner**: Bot owner only
- **Array**: Specific user IDs (e.g., `['1234567890', '0987654321']`)

### UI Auto-Wrapping

Commands with `ui` property automatically get smart error handling:

```javascript
{
    name: 'fetch',
    ui: {
        processingText: 'Fetching data...',
        errorText: 'Failed to fetch'
    },
    execute: async (msg, params, context) => {
        // Your code here
        // Errors are automatically caught and displayed
        const data = await fetchSomething();
        return `Result: ${data}`;
    }
}
```

To disable auto-wrapping:
```javascript
{
    name: 'rawcommand',
    autoWrap: false,  // Disable UI wrapping
    execute: async (msg, params, context) => {
        // Handle errors manually
    }
}
```

### Loading Custom Modules

#### Method 1: File System
Place your module in `modules/custom_modules/`, then restart the bot.

#### Method 2: Dynamic Loading
Send the `.js` file to the bot and reply with:
```
.lm
```

The module will be loaded instantly without restart.

### Module Lifecycle Hooks

```javascript
class MyModule {
    constructor(bot) {
        // ... setup commands ...

        // Message hooks
        this.messageHooks = {
            'pre_process': this.beforeMessage.bind(this),
            'post_process': this.afterMessage.bind(this)
        };
    }

    async beforeMessage(msg, text, bot) {
        // Called before message processing
        console.log('Message received:', text);
    }

    async afterMessage(msg, text, bot) {
        // Called after message processing
        console.log('Message processed');
    }
}
```

---

## Database Integration

### Using MongoDB Collections

All modules have access to the MongoDB database:

```javascript
class MyModule {
    constructor(bot) {
        this.bot = bot;
        this.db = null;
        this.collection = null;
    }

    async init() {
        // Get database instance
        this.db = this.bot.db;

        // Get or create collection
        this.collection = this.db.collection('my_data');

        // Create indexes for better performance
        await this.collection.createIndex({ userId: 1 });
        await this.collection.createIndex({ timestamp: -1 });
    }

    async saveUserData(userId, data) {
        await this.collection.updateOne(
            { userId },
            { $set: { ...data, updatedAt: new Date() } },
            { upsert: true }
        );
    }

    async getUserData(userId) {
        return await this.collection.findOne({ userId });
    }

    async deleteUserData(userId) {
        await this.collection.deleteOne({ userId });
    }
}
```

### Database Best Practices

1. **Always use indexes** for frequently queried fields
2. **Use upsert** for update-or-insert operations
3. **Store timestamps** for tracking changes
4. **Clean up old data** periodically
5. **Handle errors gracefully** with try-catch

### Example: Persistent User Settings

```javascript
class SettingsModule {
    constructor(bot) {
        this.bot = bot;
        this.commands = [
            {
                name: 'setlang',
                description: 'Set your language',
                usage: '.setlang <en|es|fr>',
                permissions: 'public',
                execute: this.setLanguage.bind(this)
            }
        ];
    }

    async init() {
        this.db = this.bot.db;
        this.settings = this.db.collection('user_settings');
        await this.settings.createIndex({ userId: 1 });
    }

    async setLanguage(msg, params, context) {
        const userId = context.participant.split('@')[0];
        const lang = params[0];

        if (!['en', 'es', 'fr'].includes(lang)) {
            return 'Invalid language. Use: en, es, or fr';
        }

        await this.settings.updateOne(
            { userId },
            {
                $set: {
                    language: lang,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        return `Language set to ${lang}`;
    }

    async getUserLanguage(userId) {
        const settings = await this.settings.findOne({ userId });
        return settings?.language || 'en';
    }
}
```

---


## Advanced Features

### Store System

HyperWa includes an enhanced store system for message history:

```javascript
// Get chat information
const chatInfo = this.bot.getChatInfo(jid);

// Get contact information (LID-compatible)
const contact = this.bot.getContactInfo(jid);

// Get all messages from a chat
const messages = this.bot.getChatMessages(jid, 50);

// Search messages by text
const results = this.bot.searchMessages('hello', jid);

// Get user statistics
const stats = this.bot.getUserStats(userId);

// Export chat history
const history = await this.bot.exportChatHistory(jid, 'json');
```

### Rate Limiting

Commands are automatically rate-limited (15 commands per minute by default). Bypass for specific users:

```javascript
// In your module
if (this.isOwner(userId)) {
    // Owner bypasses rate limits
}
```

### Smart Error Handling

Use the `helpers.smartErrorRespond` utility for better UX:

```javascript
import helpers from '../utils/helpers.js';

async handleCommand(msg, params, context) {
    await helpers.smartErrorRespond(context.bot, msg, {
        processingText: 'Fetching data...',
        errorText: 'Failed to fetch data',
        actionFn: async () => {
            const data = await fetchSomething();
            return `Result: ${data}`;
        }
    });
}
```

---

## Troubleshooting

### Common Issues

**1. QR Code not appearing**
- Check if port 5000 is available
- Ensure `qrcode-terminal` is installed
- Check logs in `logs/bot.log`

**2. Commands not working**
- Verify command prefix in config (`bot.prefix`)
- Check permissions (`features.mode`)
- Ensure module is loaded (`.modules`)

**3. MongoDB connection failed**
- Verify MongoDB URI in config
- Check network connectivity
- Ensure IP is whitelisted (for MongoDB Atlas)

**4. Telegram bridge not working**
- Verify bot token
- Check chat ID format (should include `-`)
- Ensure bot is added to the group

**5. Media processing errors**
- Install FFmpeg: `sudo apt install ffmpeg`
- Check temp directory permissions
- Verify disk space

### Debug Mode

Enable detailed logging:
```bash
LOG_LEVEL=debug npm start
```

Check logs:
```bash
tail -f logs/bot.log
```

---

## Performance Optimization

### Memory Management

Monitor memory usage:
```
.memory
```

Clear old conversations:
```
.chatdel all
```

### Database Optimization

Create indexes for frequently queried fields:
```javascript
await collection.createIndex({ userId: 1, timestamp: -1 });
```

### Rate Limiting

Adjust rate limits in `core/rate-limiter.js`:
```javascript
const maxCommands = 15;      // Max commands
const windowMs = 60000;      // Per minute
```

---

## Security Best Practices

1. **Never expose your API keys** in public repositories
2. **Use environment variables** for sensitive data
3. **Enable MongoDB authentication** in production
4. **Restrict bot to trusted users** (use `features.mode: 'private'`)
5. **Regular backups** of auth_info and database
6. **Monitor logs** for suspicious activity
7. **Keep dependencies updated**: `npm update`

---

## Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test thoroughly
5. Commit: `git commit -m "Add feature"`
6. Push: `git push origin feature-name`
7. Create a Pull Request

### Code Style

- Use ES6+ features
- Follow existing naming conventions
- Add JSDoc comments for functions
- Keep functions small and focused
- Use async/await for promises

---

## Changelog

### Version 3.0.0
- Added enhanced store system with LID support
- Improved MongoDB authentication backup
- Added smart error handling utilities
- Implemented UI auto-wrapping for commands
- Enhanced Telegram bridge with topics support
- Added Gemini Vision module
- Improved module loading system
- Added dynamic module loading via files
- Enhanced rate limiting
- Better error logging and debugging

### Version 2.0.0
- Added Telegram integration
- Implemented MongoDB support
- Added modular architecture
- Enhanced AI features

### Version 1.0.0
- Initial release
- Basic WhatsApp bot functionality

---

## Credits

**Built with:**
- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) - Telegram Bot API
- [MongoDB](https://www.mongodb.com/) - Database
- [Google Gemini](https://deepmind.google/technologies/gemini/) - AI capabilities
- [FFmpeg](https://ffmpeg.org/) - Media processing

---

**Made with dedication by Arshman**

