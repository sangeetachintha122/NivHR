import 'dotenv/config';
import mongoose from 'mongoose';
import Attendance from './models/Attendance.js';
import User from './models/User.js';
import connectDatabase from './config/database.js';
import {
  getIndiaDate,
  getIndiaMillisecondsSinceMidnight,
  isLateCheckIn,
  isWorkingDay,
} from './config/attendanceConfig.js';

const ATTENDANCE_DAYS = 20;
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const OFFICE_END_MINUTES = 18 * 60 + 30;

const dateFromParts = (dateString) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const formatUtcDate = (date) => date.toISOString().slice(0, 10);

const getPreviousWorkingDays = (today) => {
  const days = [];
  const cursor = dateFromParts(today);
  cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (days.length < ATTENDANCE_DAYS) {
    const dateString = formatUtcDate(cursor);
    if (isWorkingDay(dateString)) days.push(dateString);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return days.reverse();
};

const istDateTimeToUtc = (dateString, hour, minute) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * 60 * 1000,
  );
};

const getScenario = (employeeIndex, dayIndex) => {
  switch (employeeIndex % 6) {
    case 0:
      return { late: false, early: false };
    case 1:
      return dayIndex % 2 === 0
        ? { late: true, early: true }
        : { late: false, early: false };
    case 2:
      return { late: dayIndex % 3 === 1, early: false };
    case 3:
      return { late: false, early: dayIndex % 3 === 2 };
    case 4:
      return { late: dayIndex % 4 === 0, early: dayIndex % 4 === 1 };
    default:
      return { late: dayIndex % 5 === 2, early: dayIndex % 5 === 2 || dayIndex % 5 === 4 };
  }
};

const getCheckInTime = (late, employeeIndex, dayIndex) => {
  if (late) return { hour: 9, minute: 31 + ((employeeIndex * 7 + dayIndex * 11) % 29) };
  return { hour: 9, minute: (employeeIndex * 5 + dayIndex * 3) % 31 };
};

const getCheckOutTime = (early, employeeIndex, dayIndex) => {
  if (early) {
    const minutesAfterFive = (employeeIndex * 13 + dayIndex * 17) % 90;
    const totalMinutes = 17 * 60 + minutesAfterFive;
    return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
  }

  const minutesAfterOfficeEnd = (employeeIndex * 11 + dayIndex * 7) % 30;
  const totalMinutes = OFFICE_END_MINUTES + minutesAfterOfficeEnd;
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
};

const keyFor = (employeeId, date) => `${employeeId.toString()}:${date}`;

const seedAttendance = async () => {
  await connectDatabase();

  const today = getIndiaDate();
  const workingDates = getPreviousWorkingDays(today);
  const employees = await User.find({ role: 'employee', isActive: true })
    .select('_id joinDate')
    .sort({ _id: 1 })
    .lean();

  let employeesProcessed = 0;
  let employeesSkippedMissingJoinDate = 0;
  let existingRecordsSkipped = 0;
  let newRecordsCreated = 0;
  const targetKeys = new Set();
  const employeeIds = [];

  for (const [employeeIndex, employee] of employees.entries()) {
    if (!employee.joinDate) {
      employeesSkippedMissingJoinDate += 1;
      continue;
    }

    employeesProcessed += 1;
    employeeIds.push(employee._id);
    const joinDate = getIndiaDate(new Date(employee.joinDate));
    const eligibleDates = workingDates.filter((date) => date >= joinDate);

    for (const [dayIndex, date] of eligibleDates.entries()) {
      const { late, early } = getScenario(employeeIndex, dayIndex);
      const checkInTime = getCheckInTime(late, employeeIndex, dayIndex);
      const checkOutTime = getCheckOutTime(early, employeeIndex, dayIndex);
      const filter = { employeeId: employee._id, date };
      const timestamp = new Date();

      targetKeys.add(keyFor(employee._id, date));

      try {
        const result = await Attendance.updateOne(
          filter,
          {
            $setOnInsert: {
              ...filter,
              checkIn: istDateTimeToUtc(date, checkInTime.hour, checkInTime.minute),
              checkOut: istDateTimeToUtc(date, checkOutTime.hour, checkOutTime.minute),
              isLate: isLateCheckIn(istDateTimeToUtc(date, checkInTime.hour, checkInTime.minute)),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          },
          { upsert: true, runValidators: true, timestamps: false },
        );

        if (result.upsertedCount === 1) newRecordsCreated += 1;
        else existingRecordsSkipped += 1;
      } catch (error) {
        if (error.code !== 11000 || !(await Attendance.exists(filter))) throw error;
        existingRecordsSkipped += 1;
      }
    }
  }

  const targetRecords = targetKeys.size && employeeIds.length
    ? await Attendance.find({ employeeId: { $in: employeeIds }, date: { $in: workingDates } })
      .select('employeeId date checkIn checkOut')
      .lean()
    : [];
  const seededWindowRecords = targetRecords.filter((record) =>
    targetKeys.has(keyFor(record.employeeId, record.date)));

  let onTimeArrivals = 0;
  let lateArrivals = 0;
  let earlyDepartures = 0;
  let onTimeDepartures = 0;

  for (const record of seededWindowRecords) {
    if (isLateCheckIn(record.checkIn)) lateArrivals += 1;
    else onTimeArrivals += 1;

    if (record.checkOut) {
      if (getIndiaMillisecondsSinceMidnight(record.checkOut) < OFFICE_END_MINUTES * 60 * 1000) {
        earlyDepartures += 1;
      } else {
        onTimeDepartures += 1;
      }
    }
  }

  const totalAttendanceRecords = await Attendance.countDocuments();

  console.log('Attendance seed summary (previous 20 working days):');
  console.log(`Employees processed: ${employeesProcessed}`);
  if (employeesSkippedMissingJoinDate) {
    console.log(`Employees skipped (missing join date): ${employeesSkippedMissingJoinDate}`);
  }
  console.log(`Existing records skipped: ${existingRecordsSkipped}`);
  console.log(`New records created: ${newRecordsCreated}`);
  console.log(`Total attendance records: ${totalAttendanceRecords}`);
  console.log(`On-time arrivals: ${onTimeArrivals}`);
  console.log(`Late arrivals: ${lateArrivals}`);
  console.log(`Early departures: ${earlyDepartures}`);
  console.log(`On-time departures: ${onTimeDepartures}`);
};

try {
  await seedAttendance();
} catch (error) {
  console.error(`Attendance seeding failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
