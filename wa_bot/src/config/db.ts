import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI 
  ? process.env.MONGO_URI.replace(/(mongodb(\+srv)?:\/\/[^/]+)(\/[^?]*)?(\?|$)/, '$1/wa_web_user_sessions$4')
  : "mongodb://localhost:27017/wa_web_user_sessions?retryWrites=true&w=majority";

export const connectDB = async () => {
  try {
    if (process.env.NODE_ENV !== 'production') {
      mongoose.set('debug', (collectionName, method, query) => {
        if (method === 'find' && collectionName === 'wa_bot') {
          return false;
        }
        console.log(`📦 ${collectionName}.${method}`, query);
      });
    }

    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    console.log(`✅ Connected to MongoDB: ${mongoose.connection.db?.databaseName}`);
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log("🚫 MongoDB disconnected");
  } catch (error) {
    console.error("❌ Disconnection error:", error instanceof Error ? error.message : error);
  }
};

// Basic connection event listeners
mongoose.connection.on("connected", () => {
  console.log(`📊 Connected to ${mongoose.connection.db?.databaseName || 'unknown database'}`);
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Connection error:", err.message);
});

mongoose.connection.on("disconnected", () => {
  console.log("🚫 MongoDB disconnected");
});

// Utility function for direct access
export const getDb = () => {
  if (!mongoose.connection.db) {
    throw new Error("Database not connected");
  }
  return mongoose.connection.db;
};