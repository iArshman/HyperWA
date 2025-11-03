import config from '../config.js';
import { MongoClient } from 'mongodb';

const MONGO_URI = config.get('mongo.uri');
const DB_NAME = config.get('mongo.dbName');
const OPTIONS = config.get('mongo.options');

const client = new MongoClient(MONGO_URI, OPTIONS);

async function connectDb() {
    if (!client.topology?.isConnected()) {
        await client.connect();
    }
    return client.db(DB_NAME);
}

export { connectDb };
