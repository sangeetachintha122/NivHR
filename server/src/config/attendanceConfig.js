export const ATTENDANCE_TIME_ZONE = 'Asia/Kolkata';
export const OFFICE_START_HOUR = 9;
export const OFFICE_START_MINUTE = 30;
export const WORKING_DAYS = Object.freeze([1, 2, 3, 4, 5]);

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: ATTENDANCE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: ATTENDANCE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export const getIndiaDate = (date = new Date()) => {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const getIndiaMillisecondsSinceMidnight = (date = new Date()) => {
  const parts = Object.fromEntries(
    timeFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000
    + date.getMilliseconds();
};

export const isLateCheckIn = (date = new Date()) => {
  const officeStartMilliseconds = (OFFICE_START_HOUR * 60 + OFFICE_START_MINUTE) * 60 * 1000;
  return getIndiaMillisecondsSinceMidnight(date) > officeStartMilliseconds;
};

export const getWeekdayForIndiaDate = (dateString) =>
  new Date(`${dateString}T00:00:00.000Z`).getUTCDay();

export const isWorkingDay = (dateString) =>
  WORKING_DAYS.includes(getWeekdayForIndiaDate(dateString));
