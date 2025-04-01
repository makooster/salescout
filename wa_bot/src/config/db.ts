// src/config/db.ts
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/whatsapp_sessions";

export const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB Connected...");
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error);
    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log("🚫 MongoDB Disconnected...");
  } catch (error) {
    console.error("❌ MongoDB Disconnection Error:", error);
  }
};

// Add MongoDB connection event listeners
mongoose.connection.on("connected", () => {
  console.log("📊 MongoDB connection established");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("🚫 MongoDB connection disconnected");
});