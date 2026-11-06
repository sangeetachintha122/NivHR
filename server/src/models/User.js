import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['hr', 'employee'],
      default: 'employee',
    },
    department: {
      type: String,
    },
    joinDate: {
      type: Date,
    },
  },
  { timestamps: true },
);

const User = mongoose.model('User', userSchema);

export default User;
