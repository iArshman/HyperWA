const { useMultiFileAuthState } = require("@whiskeysockets/baileys");
const fs = require("fs-extra");
const path = require("path");
const tar = require("tar");
const { connectDb } = require("./db");

const AUTH_DIR = "./auth_info";
const STORE_FILE = "./auth_info/store.json";  
const AUTH_TAR = "auth_backup.tar"; 

async function useMongoAuthState() {
    const db = await connectDb();
    const coll = db.collection("auth");

    // Ensure local directories exist
    await fs.ensureDir(AUTH_DIR);

    // Restore session from MongoDB
    const session = await coll.findOne({ _id: "session" });
    const archiveBuffer = session?.archive?.buffer || session?.archive;

    if (archiveBuffer && Buffer.isBuffer(archiveBuffer)) {
        try {
            await fs.writeFile(AUTH_TAR, archiveBuffer);
            await tar.x({ file: AUTH_TAR, C: ".", strict: true });

            const credsPath = path.join(AUTH_DIR, "creds.json");
            if (await fs.pathExists(credsPath)) {
                console.log("✅ Auth session restored successfully from MongoDB.");
            } else {
                console.warn("⚠️ Auth archive extracted but creds.json missing. Clearing session.");
                await coll.deleteOne({ _id: "session" });
                await fs.emptyDir(AUTH_DIR);
            }
            
            // Check if store.json was restored
            if (await fs.pathExists(STORE_FILE)) {
                console.log("✅ Store data restored from MongoDB.");
            }
        } catch (err) {
            console.error("❌ Failed to restore session from MongoDB:", err);
            await coll.deleteOne({ _id: "session" });
            await fs.emptyDir(AUTH_DIR);
            await fs.remove(STORE_FILE).catch(() => {});
        } finally {
            await fs.remove(AUTH_TAR).catch(() => {});
        }
    } else {
        console.log("ℹ️ No existing session found in DB. A new QR/pairing code will be generated.");
    }

    // Generate Baileys multi-file auth state
    const { state, saveCreds: originalSaveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Save all auth files + store.json to MongoDB
    async function saveCreds() {
        await originalSaveCreds();

        // Create list of files to backup
        const filesToBackup = ["auth_info"];
        if (await fs.pathExists(STORE_FILE)) {
            filesToBackup.push("store.json");
        }

        // Compress everything
        await tar.c({ file: AUTH_TAR, cwd: ".", portable: true }, filesToBackup);
        const data = await fs.readFile(AUTH_TAR);

        await coll.updateOne(
            { _id: "session" },
            { $set: { archive: data, timestamp: new Date() } },
            { upsert: true }
        );

        await fs.remove(AUTH_TAR).catch(() => {});
      //  console.log("💾 Session and store saved to MongoDB.");
    }

    return { state, saveCreds };
}

module.exports = { useMongoAuthState };
