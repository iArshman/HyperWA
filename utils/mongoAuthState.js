import { useMultiFileAuthState } from "@whiskeysockets/baileys";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import tar from "tar";
import { connectDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_DIR = "./auth_info";
const AUTH_TAR = "auth_backup.tar";
const KEYS_DIR = path.join(AUTH_DIR, "keys");
const CREDS_PATH = path.join(AUTH_DIR, "creds.json");

/**
 * MongoDB-backed authentication state for Baileys
 * Stores session data (creds.json + keys/) as a tar archive in MongoDB
 */
export async function useMongoAuthState() {
    const db = await connectDb();
    const coll = db.collection("auth");

    // Ensure auth directory exists
    await fs.ensureDir(AUTH_DIR);

    // Try to restore session from MongoDB
    const session = await coll.findOne({ _id: "session" });
    const archiveBuffer = session?.archive?.buffer || session?.archive;

    if (archiveBuffer && Buffer.isBuffer(archiveBuffer)) {
        try {
            // Write tar archive and extract it
            await fs.writeFile(AUTH_TAR, archiveBuffer);
            await tar.x({ 
                file: AUTH_TAR, 
                C: ".", 
                strict: true 
            });

            // ✅ Validate critical files after extraction
            if (!(await fs.pathExists(CREDS_PATH))) {
                console.warn("⚠️ creds.json missing after restore. Clearing corrupted session.");
                await coll.deleteOne({ _id: "session" });
                await fs.emptyDir(AUTH_DIR);
            } else {
                // ✅ Ensure keys/ directory exists and has content
                if (!(await fs.pathExists(KEYS_DIR))) {
                    await fs.ensureDir(KEYS_DIR);
                    console.warn("⚠️ keys/ directory was missing — created empty. This may cause decryption failures.");
                } else {
                    const keyFiles = await fs.readdir(KEYS_DIR);
                    console.log(`🔐 Restored keys/ with ${keyFiles.length} session files`);
                }
                console.log("✅ Auth session (creds + keys) restored from MongoDB.");
            }
        } catch (err) {
            console.error("❌ Failed to restore session from MongoDB:", err);
            // Clear corrupted session
            await coll.deleteOne({ _id: "session" });
            await fs.emptyDir(AUTH_DIR);
        } finally {
            // Cleanup tar file
            await fs.remove(AUTH_TAR).catch(() => {});
        }
    } else {
        console.log("ℹ️ No session found in DB. New pairing required.");
    }

    // ✅ Wait for file system operations to settle
    await new Promise(resolve => setTimeout(resolve, 500));

    // Initialize Baileys multi-file auth state
    const { state, saveCreds: originalSaveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // ✅ Debounced save to prevent I/O flooding
    let saveTimer;
    
    /**
     * Save credentials to MongoDB with debouncing
     * Waits 10 seconds after last change before saving
     */
    async function saveCreds() {
        // Save to local files first
        await originalSaveCreds();

        // Debounce MongoDB save
        if (saveTimer) {
            clearTimeout(saveTimer);
        }

        saveTimer = setTimeout(async () => {
            try {
                // Create tar archive of auth_info directory
                await tar.c(
                    { 
                        file: AUTH_TAR, 
                        cwd: ".", 
                        portable: true 
                    },
                    ["auth_info"]
                );

                // Read archive as buffer
                const data = await fs.readFile(AUTH_TAR);

                // Update MongoDB with new session data
                await coll.updateOne(
                    { _id: "session" },
                    { 
                        $set: { 
                            archive: data, 
                            timestamp: new Date() 
                        } 
                    },
                    { upsert: true }
                );

                console.log("💾 Session saved to MongoDB.");
            } catch (err) {
                console.error("❌ Failed to save session to MongoDB:", err);
            } finally {
                // Cleanup tar file
                await fs.remove(AUTH_TAR).catch(() => {});
            }
        }, 10000); // Save at most every 10 seconds
    }

    return { state, saveCreds };
}

/**
 * Clear MongoDB auth session
 * Useful for logout scenarios
 */
export async function clearMongoAuthState() {
    try {
        const db = await connectDb();
        const coll = db.collection("auth");
        await coll.deleteOne({ _id: "session" });
        console.log("🗑️ MongoDB auth session cleared");
        
        // Also clear local files
        await fs.emptyDir(AUTH_DIR);
        console.log("🗑️ Local auth files cleared");
    } catch (err) {
        console.error("❌ Failed to clear MongoDB auth state:", err);
        throw err;
    }
}
