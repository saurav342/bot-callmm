import { initAuthCreds } from '@whiskeysockets/baileys/lib/Utils/auth-utils.js';
import { BufferJSON } from '@whiskeysockets/baileys/lib/Utils/generics.js';
import { proto } from '@whiskeysockets/baileys';

/**
 * Custom MongoDB-backed authentication state provider for Baileys.
 * 
 * Storing sessions in a database prevents them from being lost when Heroku
 * restarts the dynos daily (ephemeral filesystem).
 * 
 * @param {import('mongodb').Collection} collection - The MongoDB collection to store state in
 * @param {string} sessionId - A unique identifier for this session (e.g. 'bot_1' or 'bot_2')
 */
export async function useMongoAuthState(collection, sessionId) {
    const writeData = async (data, file) => {
        const id = `${sessionId}_${file}`;
        const serialized = JSON.stringify(data, BufferJSON.replacer);
        await collection.updateOne(
            { _id: id },
            { $set: { data: serialized, updatedAt: new Date() } },
            { upsert: true }
        );
    };

    const readData = async (file) => {
        try {
            const id = `${sessionId}_${file}`;
            const doc = await collection.findOne({ _id: id });
            if (!doc || !doc.data) return null;
            return JSON.parse(doc.data, BufferJSON.reviver);
        } catch (error) {
            return null;
        }
    };

    const removeData = async (file) => {
        try {
            const id = `${sessionId}_${file}`;
            await collection.deleteOne({ _id: id });
        } catch (error) {
            // Ignore delete errors
        }
    };

    // Load credentials (or initialize if not exists)
    const creds = (await readData('creds.json')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    const docIds = ids.map(id => `${sessionId}_${type}-${id}.json`);
                    
                    try {
                        const docs = await collection.find({ _id: { $in: docIds } }).toArray();
                        const docMap = {};
                        for (const doc of docs) {
                            docMap[doc._id] = doc.data;
                        }

                        for (const id of ids) {
                            const docId = `${sessionId}_${type}-${id}.json`;
                            const serialized = docMap[docId];
                            let value = null;
                            if (serialized) {
                                try {
                                    value = JSON.parse(serialized, BufferJSON.reviver);
                                    if (type === 'app-state-sync-key') {
                                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                    }
                                } catch (err) {
                                    // Parse error or invalid format
                                }
                            }
                            data[id] = value;
                        }
                    } catch (err) {
                        console.error(`[MongoAuth] Failed to bulk read keys for type ${type}:`, err.message);
                        for (const id of ids) {
                            data[id] = null;
                        }
                    }
                    return data;
                },
                set: async (data) => {
                    const operations = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const file = `${category}-${id}.json`;
                            const docId = `${sessionId}_${file}`;

                            if (value) {
                                const serialized = JSON.stringify(value, BufferJSON.replacer);
                                operations.push({
                                    updateOne: {
                                        filter: { _id: docId },
                                        update: { $set: { data: serialized, updatedAt: new Date() } },
                                        upsert: true
                                    }
                                });
                            } else {
                                operations.push({
                                    deleteOne: {
                                        filter: { _id: docId }
                                    }
                                });
                            }
                        }
                    }
                    if (operations.length > 0) {
                        try {
                            await collection.bulkWrite(operations, { ordered: false });
                        } catch (err) {
                            console.error('[MongoAuth] Failed to bulk write keys:', err.message);
                        }
                    }
                },
            },
        },
        saveCreds: async () => {
            return writeData(creds, 'creds.json');
        },
    };
}
