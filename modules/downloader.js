class DownloaderModule {
    constructor(bot) {
        this.bot = bot;
        this.name = 'downloader';
        this.metadata = {
            description: 'Downloads media from various platforms like TikTok, Instagram, YouTube, Spotify, etc.',
            version: '2.0.0',
            author: 'HyperWa Team', 
            category: 'utility'
        };

        // API endpoints
        this.delirusApi = 'https://delirius-apiofc.vercel.app/download';
        this.nekoApi = 'https://api.nekorinn.my.id/downloader';
        this.spotifyApi = 'https://api.nekorinn.my.id/downloader/spotify';

        this.commands = [
            // Social Media Downloads
            {
                name: 'tiktok',
                description: 'Downloads a TikTok video',
                usage: '.tiktok <url>',
                aliases: ['tt'],
                permissions: 'public',
                execute: this.downloadTikTok.bind(this)
            },
            {
                name: 'instagram',
                description: 'Downloads Instagram content (post or story)',
                usage: '.instagram <url>',
                aliases: ['ig', 'insta'],
                permissions: 'public',
                execute: this.downloadInstagram.bind(this)
            },
            {
                name: 'twitter',
                description: 'Downloads a video from Twitter / X.com',
                usage: '.twitter <url>',
                aliases: ['x'],
                permissions: 'public',
                execute: this.downloadTwitter.bind(this)
            },
            {
                name: 'facebook',
                description: 'Downloads a video from Facebook',
                usage: '.facebook <url>',
                aliases: ['fb'],
                permissions: 'public',
                execute: this.downloadFacebook.bind(this)
            },
            
            // Music Downloads
            {
                name: 'spotify',
                description: 'Downloads a Spotify track as MP3 audio file',
                usage: '.spotify <url>',
                aliases: ['sp', 'spotdl'],
                permissions: 'public',
                execute: this.downloadSpotify.bind(this)
            },
            {
                name: 'soundcloud',
                description: 'Downloads a track from SoundCloud',
                usage: '.soundcloud <url>',
                aliases: ['sc'],
                permissions: 'public',
                execute: this.downloadSoundCloud.bind(this)
            },
            
            // YouTube Downloads
            {
                name: 'yt-mp3',
                description: 'Downloads a YouTube video as MP3 audio file',
                usage: '.ytmp3 <url>',
                aliases: ['ytmp3', 'ytaudio'],
                permissions: 'public',
                execute: this.downloadYouTubeMP3.bind(this)
            },
            {
                name: 'yt-mp4',
                description: 'Downloads a YouTube video as MP4 video file',
                usage: '.yt <url>',
                aliases: ['yt', 'ytvideo'],
                permissions: 'public',
                execute: this.downloadYouTubeMP4.bind(this)
            }
        ];
    }

    // Helper function to convert numbers into readable format
    _convertMiles(num) {
        const number = Number(num);
        if (isNaN(number)) return num;
        if (number < 1000) return number.toString();
        if (number < 1000000) return (number / 1000).toFixed(1) + 'k';
        return (number / 1000000).toFixed(1) + 'M';
    }

    // Helper function to format duration
    _formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return 'Unknown';
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    // Generic API request handler
    async _fetchFromApi(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            throw new Error(`API request failed: ${error.message}`);
        }
    }

    // Helper function to download and send media
    async _downloadAndSendMedia(msg, mediaUrl, caption, type, context) {
        try {
            const response = await fetch(mediaUrl);
            if (!response.ok) throw new Error(`Failed to fetch media: ${response.status}`);
            
            const buffer = await response.arrayBuffer();
            const bufferData = Buffer.from(buffer);

            let message;
            if (type === 'video') {
                message = {
                    video: bufferData,
                    caption: caption,
                    mimetype: 'video/mp4'
                };
            } else if (type === 'audio') {
                message = {
                    audio: bufferData,
                    caption: caption,
                    mimetype: 'audio/mpeg'
                };
            } else if (type === 'image') {
                message = {
                    image: bufferData,
                    caption: caption,
                    mimetype: 'image/jpeg'
                };
            } else {
                throw new Error('Unsupported media type');
            }

            await context.bot.sendMessage(context.sender, message);
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `${caption}\n\n❌ Failed to send media: ${error.message}\n🔗 Direct URL: ${mediaUrl}`
            });
        }
    }

    // TikTok Download
    async downloadTikTok(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a TikTok URL.\n\n💡 Usage: `.tiktok <url>`'
            });
        }

        const url = params[0];
        
        try {
            const result = await this._fetchFromApi(`${this.delirusApi}/tiktok?url=${encodeURIComponent(url)}`);
            const data = result.data;

            const caption = `╭  ✦ TikTok Download ✦  ╮\n\n` +
                           `*◦ Name:* ${data.author.nickname}\n` +
                           `*◦ Username:* ${data.author.username}\n` +
                           `*◦ Duration:* ${data.duration}s\n` +
                           `*◦ Plays:* ${this._convertMiles(data.repro)}\n` +
                           `*◦ Likes:* ${this._convertMiles(data.like)}\n` +
                           `*◦ Shares:* ${this._convertMiles(data.share)}\n` +
                           `*◦ Comments:* ${this._convertMiles(data.comment)}\n` +
                           `*◦ Downloads:* ${this._convertMiles(data.download)}\n\n` +
                           `╭  ✦ Music Info ✦  ╮\n\n` +
                           `*◦ Music:* ${data.music.title}\n` +
                           `*◦ Author:* ${data.music.author}\n` +
                           `*◦ Duration:* ${data.music.duration}s`;

            const mediaUrl = data.meta.media[0].hd || data.meta.media[0].org;
            await this._downloadAndSendMedia(msg, mediaUrl, caption, 'video', context);
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download TikTok video: ${error.message}`
            });
        }
    }

    // Instagram Download
    async downloadInstagram(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide an Instagram URL.\n\n💡 Usage: `.instagram <url>`'
            });
        }

        const url = params[0];
        
        try {
            const endpoint = url.includes('/stories/') ? 'igstories' : 'instagram';
            const result = await this._fetchFromApi(`${this.delirusApi}/${endpoint}?url=${encodeURIComponent(url)}`);
            const media = result.data;

            let responseText = `*亗 I N S T A G R A M*\n\n`;
            
            for (let i = 0; i < media.length; i++) {
                const item = media[i];
                responseText += `*› Media ${i + 1} [${item.type}]:*\n`;
                
            if (item.type === 'image') {
                await this._downloadAndSendMedia(msg, item.url, null, 'image', context);
            } else if (item.type === 'video') {
                await this._downloadAndSendMedia(msg, item.url, null, 'video', context);
            }
            }
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download Instagram content: ${error.message}`
            });
        }
    }

    // Twitter Download
    async downloadTwitter(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a Twitter/X URL.\n\n💡 Usage: `.twitter <url>`'
            });
        }

        const url = params[0];
        
        try {
            const result = await this._fetchFromApi(`${this.delirusApi}/twitterv2?url=${encodeURIComponent(url)}`);
            const data = result.data;
            
            if (!data.media || !data.media[0]) {
                return await context.bot.sendMessage(context.sender, {
                    text: '❌ This tweet does not contain any media.'
                });
            }
            
            const media = data.media[0];
            const caption = `╭  ✦ Twitter Download ✦  ╮\n\n` +
                           `*◦ Author:* @${data.author.username}\n` +
                           `*◦ Description:* ${data.description.split('https://')[0]}\n` +
                           `*◦ Views:* ${this._convertMiles(data.view)}\n` +
                           `*◦ Likes:* ${this._convertMiles(data.favorite)}\n` +
                           `*◦ Retweets:* ${this._convertMiles(data.retweet)}`;
            
            if (media.type === 'video' && media.videos && media.videos.length > 0) {
                const bestVideo = media.videos[media.videos.length - 1];
                await this._downloadAndSendMedia(msg, bestVideo.url, caption, 'video', context);
            } else if (media.type === 'photo' && media.image) {
                await this._downloadAndSendMedia(msg, media.image, caption, 'image', context);
            } else if (media.type === 'gif' && media.videos && media.videos.length > 0) {
                const gifVideo = media.videos[0];
                await this._downloadAndSendMedia(msg, gifVideo.url, caption, 'video', context);
            } else {
                await context.bot.sendMessage(context.sender, {
                    text: '❌ Unsupported media type or media not available.'
                });
            }
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download Twitter media: ${error.message}`
            });
        }
    }

    // Facebook Download
    async downloadFacebook(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a Facebook URL.\n\n💡 Usage: `.facebook <url>`'
            });
        }

        const url = params[0];
        
        try {
            const result = await this._fetchFromApi(`${this.delirusApi}/facebook?url=${encodeURIComponent(url)}`);
            
            if (!result.urls || !Array.isArray(result.urls) || result.urls.length === 0) {
                throw new Error('No media URLs found in API response');
            }

            const caption = `╭  ✦ Facebook Downloader\n\n` +
                           `*◦ Title:* ${result.title || 'No title available'}`;

            const mediaUrl = result.urls[0].hd || result.urls[1]?.sd;
            if (!mediaUrl) {
                throw new Error('No valid media URL found');
            }

            await this._downloadAndSendMedia(msg, mediaUrl, caption, 'video', context);
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download Facebook video: ${error.message}`
            });
        }
    }

    // Spotify Download
    async downloadSpotify(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a Spotify URL.\n\n💡 Usage: `.spotify <url>`'
            });
        }

        const url = params[0];
        
        if (!this._isValidSpotifyUrl(url)) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a valid Spotify URL.'
            });
        }

        try {
            const result = await this._fetchFromApi(`${this.spotifyApi}?url=${encodeURIComponent(url)}`);
            
            if (!result.status || !result.result) {
                throw new Error('Invalid API response');
            }

            const data = result.result;
            
            const caption = `╭  ✦ Spotify Download ✦  ╮\n\n` +
                           `*◦ Title:* ${data.title || 'Unknown Title'}\n` +
                           `*◦ Artist:* ${data.artist || 'Unknown Artist'}\n` +
                           `*◦ Duration:* ${data.duration || 'Unknown'}\n` +
                           `*◦ Quality:* MP3\n\n` +
                           `*Downloaded from Spotify* 🎵`;

            if (data.downloadUrl) {
                await this._downloadAndSendMedia(msg, data.downloadUrl, caption, 'audio', context);
            } else {
                throw new Error('No download URL provided by API');
            }
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download Spotify track: ${error.message}`
            });
        }
    }

    // SoundCloud Download
    async downloadSoundCloud(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a SoundCloud URL.\n\n💡 Usage: `.soundcloud <url>`'
            });
        }

        const url = params[0];
        
        try {
            const result = await this._fetchFromApi(`${this.delirusApi}/soundcloud?url=${encodeURIComponent(url)}`);
            const res = result.data;

            const caption = `╭  ✦ Soundcloud Download ✦  ╮\n\n` +
                           `*◦ Title:* ${res.title}\n` +
                           `*◦ Artist:* ${res.author}\n` +
                           `*◦ Plays:* ${this._convertMiles(res.playbacks)}\n` +
                           `*◦ Likes:* ${this._convertMiles(res.likes)}\n` +
                           `*◦ Comments:* ${this._convertMiles(res.comments)}`;

            await this._downloadAndSendMedia(msg, res.download, caption, 'audio', context);
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download SoundCloud track: ${error.message}`
            });
        }
    }

    // YouTube MP3 Download
    async downloadYouTubeMP3(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a YouTube URL.\n\n💡 Usage: `.ytmp3 <url>`'
            });
        }

        const url = params[0];
        
        try {
            const result = await this._fetchFromApi(`${this.nekoApi}/youtube?url=${encodeURIComponent(url)}&format=128&type=audio`);
            
            if (!result.status || !result.result) {
                throw new Error('Invalid API response');
            }

            const data = result.result;
            
            const caption = `╭  ✦ YouTube MP3 Download ✦  ╮\n\n` +
                           `*◦ Title:* ${data.title || 'Unknown Title'}\n` +
                           `*◦ Quality:* ${data.format || '128kbps'}\n` +
                           `*◦ Type:* ${data.type || 'audio'}`;

            if (data.downloadUrl) {
                await this._downloadAndSendMedia(msg, data.downloadUrl, caption, 'audio', context);
            } else {
                throw new Error('No download URL provided by API');
            }
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download YouTube MP3: ${error.message}`
            });
        }
    }

    // YouTube MP4 Download
    async downloadYouTubeMP4(msg, params, context) {
        if (params.length === 0) {
            return await context.bot.sendMessage(context.sender, {
                text: '❌ Please provide a YouTube URL.\n\n💡 Usage: `.yt <url>`'
            });
        }

        const url = params[0];
        
        try {
            const result = await this._fetchFromApi(`${this.nekoApi}/youtube?url=${encodeURIComponent(url)}&format=480&type=video`);
            
            if (!result.status || !result.result) {
                throw new Error('Invalid API response');
            }

            const data = result.result;
            
            const caption = `╭  ✦ YouTube MP4 Download ✦  ╮\n\n` +
                           `*◦ Title:* ${data.title || 'Unknown Title'}\n` +
                           `*◦ Quality:* ${data.format || '480p'}\n` +
                           `*◦ Type:* ${data.type || 'video'}`;

            if (data.downloadUrl) {
                await this._downloadAndSendMedia(msg, data.downloadUrl, caption, 'video', context);
            } else {
                throw new Error('No download URL provided by API');
            }
            
        } catch (error) {
            await context.bot.sendMessage(context.sender, {
                text: `❌ Failed to download YouTube MP4: ${error.message}`
            });
        }
    }

    // Helper function to validate Spotify URLs
    _isValidSpotifyUrl(url) {
        const spotifyRegex = /^https?:\/\/(open\.)?spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+(\?.*)?$/;
        return spotifyRegex.test(url);
    }
}

module.exports = DownloaderModule;
