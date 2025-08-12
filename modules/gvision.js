
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require('@google/generative-ai');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../config');
const logger = require('../Core/logger');

/**
 * GeminiVisionModule: A module for analyzing images and videos using Google Gemini Vision API.
 * Supports a variety of commands for media analysis with user-friendly feedback.
 */
class GeminiVisionModule {
  constructor(bot) {
    this.bot = bot;
    this.name = 'gvision';
    this.metadata = {
      description: 'Analyzes images and videos using Google Gemini Vision API. Now with full support for both media types in all commands!',
      version: '3.0.0',
      author: 'Your Name',
      category: 'ai',
    };

    this.genAI = null;
    this.visionModel = null;
    // --- ADD YOUR API KEY HERE ---
    this.apiKey = 'AIzaSyC1-5hrYIdfNsg2B7bcb5Qs3ib1MIWlbOE';

    // Command definitions with user-friendly UI and full media support
    this.commands = [
      {
        name: 'describe',
        description: 'Provides a detailed description of the image or video.',
        usage: '.describe (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '🖼️🎬 *Describing Media...*\n\nTaking a close look... 👀',
          errorText: '❌ *Media Description Failed*',
        },
        execute: this.describeMedia.bind(this),
      },
      {
        name: 'summarize',
        description: 'Gives a concise summary of the image or video content.',
        usage: '.summarize (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '📝 *Summarizing Media...*\n\nCapturing the essence... ✨',
          errorText: '❌ *Summary Failed*',
        },
        execute: this.summarizeMedia.bind(this),
      },
      {
        name: 'ask',
        description: 'Answers a specific question about the image or video.',
        usage: '.ask <question> (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '🤔 *Answering Your Question...*\n\nAnalyzing the media... 🔍',
          errorText: '❌ *Could Not Answer Based on Media*',
        },
        execute: this.askMedia.bind(this),
      },
      {
        name: 'ocr',
        description: 'Extracts text from the image or video.',
        usage: '.ocr (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '📄 *Extracting Text...*\n\nScanning for words... 📖',
          errorText: '❌ *Text Extraction Failed*',
        },
        execute: this.extractText.bind(this),
      },
      {
        name: 'identify',
        description: 'Identifies entities like people, animals, plants, or landmarks in the media.',
        usage: '.identify (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '🧐 *Identifying Entities...*\n\nSearching for matches... 🕵️',
          errorText: '❌ *Identification Failed*',
        },
        execute: this.identifyEntity.bind(this),
      },
      {
        name: 'detect',
        description: 'Detects and lists objects in the image or video.',
        usage: '.detect (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '🔍 *Detecting Objects...*\n\nSpotting items... 👁️',
          errorText: '❌ *Object Detection Failed*',
        },
        execute: this.detectObjects.bind(this),
      },
      {
        name: 'products',
        description: 'Identifies products in the image or video.',
        usage: '.products (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '🛍️ *Finding Products...*\n\nShopping scan in progress... 💸',
          errorText: '❌ *Product Identification Failed*',
        },
        execute: this.findProducts.bind(this),
      },
      {
        name: 'facts',
        description: 'Extracts key facts from the image or video.',
        usage: '.facts (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '📈 *Extracting Facts...*\n\nGathering insights... 🧠',
          errorText: '❌ *Fact Extraction Failed*',
        },
        execute: this.extractFacts.bind(this),
      },
      {
        name: 'caption',
        description: 'Generates a social media caption for the image or video.',
        usage: '.caption (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '✍️ *Generating Caption...*\n\nGetting creative... 🌟',
          errorText: '❌ *Caption Generation Failed*',
        },
        execute: this.generateCaption.bind(this),
      },
      {
        name: 'recipe',
        description: 'Creates a recipe based on ingredients in the image or video.',
        usage: '.recipe (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '🧑‍🍳 *Creating Recipe...*\n\nWhipping up something delicious... 🍲',
          errorText: '❌ *Recipe Creation Failed*',
        },
        execute: this.createRecipe.bind(this),
      },
      {
        name: 'meme',
        description: 'Explains the context and humor of a meme in the image or video.',
        usage: '.meme (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '😂 *Explaining Meme...*\n\nDecoding the fun... 🤭',
          errorText: '❌ *Meme Explanation Failed*',
        },
        execute: this.explainMeme.bind(this),
      },
      {
        name: 'artstyle',
        description: 'Analyzes the art style of the image or video.',
        usage: '.artstyle (reply to media)',
        permissions: 'public',
        ui: {
          processingText: '🎨 *Analyzing Art Style...*\n\nChanneling my inner critic... 🖼️',
          errorText: '❌ *Art Style Analysis Failed*',
        },
        execute: this.analyzeArtStyle.bind(this),
      },
    ];
  }

  /**
   * Initializes the Gemini client with the provided API key.
   */
  async init() {
    if (!this.apiKey || this.apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      logger.error('Gemini API key is missing from the gemini-vision.js module file.');
      throw new Error('Gemini API key not configured. Please add it directly to the module file.');
    }
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.visionModel = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });
  }

  /**
   * Retrieves the replied-to media message (image or video).
   * @param {object} msg - The message object from Baileys.
   * @returns {{mediaMessage: object, mediaType: string}|null}
   */
  _getRepliedMediaMessage(msg) {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg?.imageMessage) {
      return { mediaMessage: quotedMsg.imageMessage, mediaType: 'image' };
    }
    if (quotedMsg?.videoMessage) {
      return { mediaMessage: quotedMsg.videoMessage, mediaType: 'video' };
    }
    return null;
  }

  /**
   * Downloads media from a message and converts it to a buffer.
   * @param {object} mediaMessage - The media message object.
   * @param {string} mediaType - 'image' or 'video'.
   * @returns {Promise<Buffer>}
   */
  async _getMediaBuffer(mediaMessage, mediaType) {
    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Runs a vision prompt against the Gemini API.
   * @param {string} prompt - The text prompt for the model.
   * @param {Buffer} mediaBuffer - The media data buffer.
   * @param {string} mimeType - The MIME type ('image/jpeg' or 'video/mp4').
   * @returns {Promise<string>} The model's text response.
   */
  async _runVisionModel(prompt, mediaBuffer, mimeType) {
    if (!this.visionModel) {
      throw new Error('Gemini Vision model is not initialized.');
    }

    const mediaPart = {
      inlineData: {
        data: mediaBuffer.toString('base64'),
        mimeType,
      },
    };

    const result = await this.visionModel.generateContent([prompt, mediaPart]);
    const response = await result.response;
    return response.text();
  }

  // --- Command Implementations ---

  async describeMedia(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Provide a detailed description of this media (image or video). Include the scene, objects, actions, atmosphere, and any context. Be as descriptive as possible for accessibility.';

    const description = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*🖼️🎬 Media Description:*\n\n${description}\n\nHope that paints a clear picture! 🌟`;
  }

  async summarizeMedia(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Provide a concise summary of this media (image or video). Cover the main events, topics, or elements.';

    const summary = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*📝 Media Summary:*\n\n${summary}\n\nQuick and to the point! 📌`;
  }

  async askMedia(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to ask about it. 😊';
    }
    if (params.length === 0) {
      return 'Please provide a question after the command, like: .ask What is happening here?';
    }

    const question = params.join(' ');
    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = `Based on this media (image or video), answer the following question: "${question}"`;

    const answer = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*🤔 Your Question:* ${question}\n\n*💬 Answer:*\n${answer}\n\nGot more questions? Fire away! 🔥`;
  }

  async extractText(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Extract all visible text from this media (image or video), including any subtitles or on-screen text. Preserve formatting and line breaks. If no text is found, say so.';

    const extractedText = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*📄 Extracted Text:*\n\n${extractedText}\n\nAll the words I could find! 📖`;
  }

  async identifyEntity(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Identify the main subjects or entities in this media (image or video), such as people, animals, plants, or landmarks. Provide names and brief details if known. If unsure, give a general description.';

    const identification = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*🧐 Identification Results:*\n\n${identification}\n\nInteresting finds! 🕵️`;
  }

  async detectObjects(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'List all distinct objects visible in this media (image or video) as a simple bulleted list.';

    const objects = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*🔍 Detected Objects:*\n\n${objects}\n\nWhat do you see? 👀`;
  }

  async findProducts(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Identify any commercial products in this media (image or video). For each, provide the name, brand (if possible), and a brief description.';

    const products = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*🛍️ Products Found:*\n\n${products}\n\nHappy shopping! 🛒`;
  }

  async extractFacts(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Extract key facts or data points from this media (image or video). Present them as a clear, bulleted list.';

    const facts = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*📈 Key Facts:*\n\n${facts}\n\nFascinating stuff! 🧠`;
  }

  async generateCaption(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Generate a creative and engaging social media caption for this media (image or video). Include 2-3 relevant emojis and 3-4 hashtags.';

    const caption = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*✍️ Generated Caption:*\n\n${caption}\n\nReady to post? 📱`;
  }

  async createRecipe(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Based on the ingredients or food shown in this media (image or video), create a simple recipe. List ingredients and step-by-step instructions.';

    const recipe = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*🧑‍🍳 Recipe Idea:*\n\n${recipe}\n\nBon appétit! 🍽️`;
  }

  async explainMeme(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'This media (image or video) appears to be a meme. Explain its origin, format, humor, and why it’s funny.';

    const explanation = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*😂 Meme Explained:*\n\n${explanation}\n\nLOL, right? 😄`;
  }

  async analyzeArtStyle(msg, params, context) {
    const mediaData = this._getRepliedMediaMessage(msg);
    if (!mediaData) {
      return 'Please reply to an image or video to use this command. 😊';
    }

    const mediaBuffer = await this._getMediaBuffer(mediaData.mediaMessage, mediaData.mediaType);
    const mimeType = mediaData.mediaType === 'image' ? 'image/jpeg' : 'video/mp4';
    const prompt = 'Analyze the art style in this media (image or video). Identify the movement, key characteristics, and a related famous artist.';

    const analysis = await this._runVisionModel(prompt, mediaBuffer, mimeType);
    return `*🎨 Art Style Analysis:*\n\n${analysis}\n\nArt lover’s delight! 🖌️`;
  }
}

module.exports = GeminiVisionModule;
