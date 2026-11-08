import mongoose from 'mongoose';

const departmentCapacitySchema = new mongoose.Schema(
  {
    department: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    maxSimultaneousAbsent: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'maxSimultaneousAbsent must be an integer',
      },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

departmentCapacitySchema.index(
  { department: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);

const DepartmentCapacity = mongoose.model('DepartmentCapacity', departmentCapacitySchema);

export default DepartmentCapacity;
