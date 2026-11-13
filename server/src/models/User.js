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
      select: false,
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
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returnedObject) {
        delete returnedObject.passwordHash;
        delete returnedObject.__v;
        return returnedObject;
      },
    },
  },
);

userSchema.index({ role: 1, isActive: 1, department: 1 });
userSchema.index({ role: 1, joinDate: 1 });

const User = mongoose.model('User', userSchema);

export default User;
