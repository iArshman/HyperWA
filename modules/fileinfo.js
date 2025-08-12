const fs = require('fs-extra');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

class FileInfoModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'fileinfo';
        this.metadata = {
            description: 'Get detailed information about files and media',
            version: '1.0.0',
            author: 'HyperWa Team',
            category: 'utility',
            dependencies: ['fs-extra', '@whiskeysockets/baileys']
        };
        this.commands = [
            {
                name: 'fileinfo',
                description: 'Get file information',
                usage: '.fileinfo (reply to file/media)',
                permissions: 'public',
                ui: {
                    processingText: '📁 *Analyzing File...*\n\n⏳ Getting file information...',
                    errorText: '❌ *File Analysis Failed*'
                },
                execute: this.getFileInfo.bind(this)
            },
            {
                name: 'mediainfo',
                description: 'Get detailed media information',
                usage: '.mediainfo (reply to media)',
                permissions: 'public',
                ui: {
                    processingText: '🎬 *Analyzing Media...*\n\n⏳ Extracting media details...',
                    errorText: '❌ *Media Analysis Failed*'
                },
                execute: this.getMediaInfo.bind(this)
            }
        ];
        this.tempDir = path.join(__dirname, '../temp');
    }



    async getFileInfo(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg) {
            return '❌ *File Information*\n\nPlease reply to a file, image, video, audio, or document.\n\n💡 Usage: Reply to any media and type `.fileinfo`';
        }

        try {
            const mediaInfo = this.extractMediaInfo(quotedMsg);
            
            if (!mediaInfo) {
                return '❌ *No Media Found*\n\nThe replied message doesn\'t contain any media files.';
            }

            let infoText = `📁 *File Information*\n\n`;
            infoText += `📄 **Type:** ${mediaInfo.type}\n`;
            infoText += `📏 **Size:** ${this.formatFileSize(mediaInfo.fileLength || 0)}\n`;
            
            if (mediaInfo.mimetype) {
                infoText += `🔧 **MIME Type:** ${mediaInfo.mimetype}\n`;
            }
            
            if (mediaInfo.fileName) {
                infoText += `📝 **Filename:** ${mediaInfo.fileName}\n`;
            }
            
            if (mediaInfo.caption) {
                infoText += `💬 **Caption:** ${mediaInfo.caption.substring(0, 100)}${mediaInfo.caption.length > 100 ? '...' : ''}\n`;
            }

            // Media-specific information
            if (mediaInfo.type === 'image' && mediaInfo.width && mediaInfo.height) {
                infoText += `📐 **Dimensions:** ${mediaInfo.width} × ${mediaInfo.height}\n`;
            }
            
            if (mediaInfo.type === 'video' && mediaInfo.seconds) {
                infoText += `⏱️ **Duration:** ${this.formatDuration(mediaInfo.seconds)}\n`;
                if (mediaInfo.width && mediaInfo.height) {
                    infoText += `📐 **Resolution:** ${mediaInfo.width} × ${mediaInfo.height}\n`;
                }
            }
            
            if (mediaInfo.type === 'audio' && mediaInfo.seconds) {
                infoText += `⏱️ **Duration:** ${this.formatDuration(mediaInfo.seconds)}\n`;
            }

            if (mediaInfo.url) {
                infoText += `🔗 **Direct URL:** Available\n`;
            }

            infoText += `\n⏰ Analyzed at ${new Date().toLocaleTimeString()}`;

            return infoText;

        } catch (error) {
            throw new Error(`File analysis failed: ${error.message}`);
        }
    }

    async getMediaInfo(msg, params, context) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quotedMsg) {
            return '❌ *Media Information*\n\nPlease reply to an image, video, or audio file.\n\n💡 Usage: Reply to media and type `.mediainfo`';
        }

        try {
            const mediaInfo = this.extractMediaInfo(quotedMsg);
            
            if (!mediaInfo || !['image', 'video', 'audio'].includes(mediaInfo.type)) {
                return '❌ *No Media Found*\n\nPlease reply to an image, video, or audio file.';
            }

            // Download media for detailed analysis
            const stream = await downloadContentFromMessage(quotedMsg[`${mediaInfo.type}Message`], mediaInfo.type);
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);

            const fileName = `analysis_${Date.now()}.${this.getFileExtension(mediaInfo.mimetype)}`;
            const filePath = path.join(this.tempDir, fileName);
            await fs.writeFile(filePath, buffer);

            // Get file stats
            const stats = await fs.stat(filePath);
            
            let infoText = `🎬 *Detailed Media Information*\n\n`;
            infoText += `📄 **Type:** ${mediaInfo.type.toUpperCase()}\n`;
            infoText += `📏 **File Size:** ${this.formatFileSize(stats.size)}\n`;
            infoText += `🔧 **MIME Type:** ${mediaInfo.mimetype || 'Unknown'}\n`;
            
            if (mediaInfo.type === 'image') {
                infoText += `📐 **Dimensions:** ${mediaInfo.width || 'Unknown'} × ${mediaInfo.height || 'Unknown'}\n`;
            }
            
            if (mediaInfo.type === 'video') {
                infoText += `📐 **Resolution:** ${mediaInfo.width || 'Unknown'} × ${mediaInfo.height || 'Unknown'}\n`;
                infoText += `⏱️ **Duration:** ${this.formatDuration(mediaInfo.seconds || 0)}\n`;
                if (mediaInfo.gifPlayback) {
                    infoText += `🎭 **Type:** GIF/Animation\n`;
                }
            }
            
            if (mediaInfo.type === 'audio') {
                infoText += `⏱️ **Duration:** ${this.formatDuration(mediaInfo.seconds || 0)}\n`;
                if (mediaInfo.ptt) {
                    infoText += `🎙️ **Type:** Voice Note\n`;
                }
            }

            // Additional technical details
            infoText += `\n📊 **Technical Details:**\n`;
            infoText += `• File created: ${stats.birthtime.toLocaleString()}\n`;
            infoText += `• File modified: ${stats.mtime.toLocaleString()}\n`;
            infoText += `• Blocks: ${stats.blocks || 'N/A'}\n`;

            // Cleanup
            await fs.remove(filePath);

            infoText += `\n⏰ Analysis completed at ${new Date().toLocaleTimeString()}`;

            return infoText;

        } catch (error) {
            throw new Error(`Media analysis failed: ${error.message}`);
        }
    }

   

    extractMediaInfo(quotedMsg) {
        if (quotedMsg.imageMessage) {
            return {
                type: 'image',
                ...quotedMsg.imageMessage
            };
        }
        
        if (quotedMsg.videoMessage) {
            return {
                type: 'video',
                ...quotedMsg.videoMessage
            };
        }
        
        if (quotedMsg.audioMessage) {
            return {
                type: 'audio',
                ...quotedMsg.audioMessage
            };
        }
        
        if (quotedMsg.documentMessage) {
            return {
                type: 'document',
                ...quotedMsg.documentMessage
            };
        }
        
        if (quotedMsg.stickerMessage) {
            return {
                type: 'sticker',
                ...quotedMsg.stickerMessage
            };
        }

        return null;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatDuration(seconds) {
        if (!seconds) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    getFileExtension(mimetype) {
        const extensions = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'audio/mpeg': 'mp3',
            'audio/ogg': 'ogg',
            'audio/wav': 'wav',
            'application/pdf': 'pdf'
        };
        return extensions[mimetype] || 'bin';
    }

}

module.exports = FileInfoModule;
