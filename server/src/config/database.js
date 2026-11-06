import mongoose from 'mongoose';

const connectDatabase = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  mongoose.connection.on('error', (error) => {
    console.error('MongoDB connection error:', error);
  });

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
};

export default connectDatabase;
