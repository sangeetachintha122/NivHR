import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import connectDatabase from './config/database.js';
import User from './models/User.js';

const requiredEnvironmentVariables = [
  'SEED_HR_EMAIL',
  'SEED_HR_PASSWORD',
  'SEED_EMPLOYEE_EMAIL',
  'SEED_EMPLOYEE_PASSWORD',
];
const duplicateSeedEmailErrorMessage =
  'SEED_HR_EMAIL and SEED_EMPLOYEE_EMAIL must be different.';

const seedAccount = async ({ label, email, password, name, role }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const existingAccount = await User.exists({ email: normalizedEmail });

  if (existingAccount) {
    console.log(`${label} account skipped (already exists).`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = new User({
    name,
    email: normalizedEmail,
    passwordHash,
    role,
  });

  try {
    await user.save();
    console.log(`${label} account created.`);
  } catch (error) {
    if (error.code === 11000) {
      console.log(`${label} account skipped (already exists).`);
      return;
    }
    throw error;
  }
};

const runSeed = async () => {
  const missingVariables = requiredEnvironmentVariables.filter(
    (name) => !process.env[name] || !process.env[name].trim(),
  );

  if (missingVariables.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVariables.join(', ')}`);
  }

  const hrEmail = process.env.SEED_HR_EMAIL.trim().toLowerCase();
  const employeeEmail = process.env.SEED_EMPLOYEE_EMAIL.trim().toLowerCase();
  if (hrEmail === employeeEmail) {
    throw new Error(duplicateSeedEmailErrorMessage);
  }

  await connectDatabase();

  await seedAccount({
    label: 'HR',
    email: hrEmail,
    password: process.env.SEED_HR_PASSWORD,
    name: 'Seed HR',
    role: 'hr',
  });

  await seedAccount({
    label: 'Test employee',
    email: employeeEmail,
    password: process.env.SEED_EMPLOYEE_PASSWORD,
    name: 'Test Employee',
    role: 'employee',
  });
};

try {
  await runSeed();
} catch (error) {
  if (
    error.message.startsWith('Missing required environment variables:') ||
    error.message === duplicateSeedEmailErrorMessage
  ) {
    console.error(error.message);
  } else {
    console.error('Database seeding failed. Check configuration and database connectivity.');
  }
  process.exitCode = 1;
} finally {
  try {
    await mongoose.disconnect();
  } catch {
    console.error('Failed to close the MongoDB connection cleanly.');
    process.exitCode = 1;
  }
}
