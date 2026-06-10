import { neon } from '@neondatabase/serverless';

// --- TIME-GATE DEBOUNCE TRACKING ---
let lastPostTime = 0;
let lastGetTime = 0;
const DEBOUNCE_DELAY = 2000; // 2 seconds in milliseconds

// Securely initializes the database connection using environment variables
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
    // Enable CORS headers so your browser and ESP32 can talk to it cleanly
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const now = Date.now();

    // 1. HANDLE INCOMING DATA ENTRIES (POST)
    if (req.method === 'POST') {
        // Debounce Gate: Catch and drop duplicate POST requests firing within 2 seconds
        if (now - lastPostTime < DEBOUNCE_DELAY) {
            console.log("Duplicate POST execution blocked successfully.");
            return res.status(202).json({ success: true, message: "Duplicate payload ignored." });
        }
        lastPostTime = now; // Update the post gate timeline

        const { temp, hum } = req.body;
        
        if (temp === undefined || hum === undefined) {
            return res.status(400).json({ error: "Missing temperature or humidity values" });
        }

        try {
            // Save data to Neon
            await sql`INSERT INTO dht22_logs (temperature, humidity) VALUES (${temp}, ${hum})`;
            
            // --- THE 48-HOUR ROLLING DELETION PROTOCOL ---
            await sql`DELETE FROM dht22_logs WHERE timestamp < NOW() - INTERVAL '48 hours'`;
            
            return res.status(200).json({ success: true, message: "Data saved, old logs pruned." });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
    
    // 2. HANDLE SITE REQUESTS FOR LOG DATA (GET)
    if (req.method === 'GET') {
        // Debounce Gate: Catch and drop duplicate page-fetch hits within 2 seconds
        if (now - lastGetTime < DEBOUNCE_DELAY) {
            console.log("Duplicate GET execution blocked successfully.");
            // Return an empty 200 response to prevent the UI thread from crashing
            return res.status(200).json([]); 
        }
        lastGetTime = now; // Update the get gate timeline

        try {
            // Retrieve data points from the last 48 hours, sorted from newest to oldest
            const logs = await sql`
                SELECT timestamp, temperature, humidity 
                FROM dht22_logs 
                ON CONFLICT DO NOTHING
                ORDER BY timestamp DESC
            `;
            return res.status(200).json(logs);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
}