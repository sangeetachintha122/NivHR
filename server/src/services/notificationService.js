import nodemailer from 'nodemailer';
import User from '../models/User.js';

let transporter;

const getSmtpConfiguration = (notificationType) => {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT);
  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase();
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASS;

  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !['true', 'false'].includes(secureValue) ||
    !from ||
    Boolean(user) !== Boolean(password)
  ) {
    console.info(`Leave ${notificationType} notification skipped: SMTP configuration is incomplete.`);
    return null;
  }

  return {
    host,
    port,
    secure: secureValue === 'true',
    from,
    ...(user && password ? { auth: { user, pass: password } } : {}),
  };
};

const getTransporter = (configuration) => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      ...(configuration.auth ? { auth: configuration.auth } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return transporter;
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const logDeliveryFailure = (notificationType, error) => {
  console.error(`Leave ${notificationType} notification delivery failed.`, {
    errorType: typeof error?.name === 'string' ? error.name : 'Error',
  });
};

export const logNotificationFailure = (notificationType, error) => {
  logDeliveryFailure(notificationType, error);
};

const sendEmail = async (configuration, notificationType, message) => {
  try {
    await getTransporter(configuration).sendMail({
      from: configuration.from,
      ...message,
    });
  } catch (error) {
    logDeliveryFailure(notificationType, error);
  }
};

const getEmployee = async (leave) => {
  const employeeId = leave.employeeId?._id ?? leave.employeeId;
  if (!employeeId) return null;
  return User.findById(employeeId).select('name email').lean();
};

const getHrLeavesUrl = () => {
  try {
    const appUrl = process.env.APP_URL?.trim();
    if (!appUrl) return null;
    const url = new URL(`${appUrl.replace(/\/+$/, '')}/hr/leaves`);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

export const notifyHrOfLeaveApplication = async (leave) => {
  const hrUsers = await User.find({ role: 'hr', isActive: true }).select('email').lean();
  const recipients = hrUsers.map((user) => user.email).filter(Boolean);
  if (recipients.length === 0) {
    console.info('Leave application notification skipped: no active HR recipients.');
    return;
  }

  const configuration = getSmtpConfiguration('application');
  if (!configuration) return;

  const hrLeavesUrl = getHrLeavesUrl();
  if (!hrLeavesUrl) {
    console.info('Leave application notification skipped: APP_URL is missing or invalid.');
    return;
  }

  const employee = await getEmployee(leave);
  if (!employee?.email) {
    console.info('Leave application notification skipped: employee email is unavailable.');
    return;
  }

  const employeeName = employee.name || 'Employee';
  const fromDate = formatDate(leave.fromDate);
  const toDate = formatDate(leave.toDate);
  const reason = String(leave.reason ?? '');
  const safeReason = escapeHtml(reason).replace(/\r?\n/g, '<br>');

  await sendEmail(configuration, 'application', {
    bcc: recipients,
    subject: 'New leave application pending review',
    text: [
      'A leave application is waiting for HR review.',
      `Employee: ${employeeName} (${employee.email})`,
      `Leave type: ${leave.type}`,
      `Dates: ${fromDate} to ${toDate}`,
      `Working days: ${leave.totalDays}`,
      `Reason: ${reason}`,
      `Review: ${hrLeavesUrl}`,
    ].join('\n'),
    html: `<h2>Leave application pending review</h2>
      <p><strong>Employee:</strong> ${escapeHtml(employeeName)} (${escapeHtml(employee.email)})</p>
      <p><strong>Leave type:</strong> ${escapeHtml(leave.type)}</p>
      <p><strong>Dates:</strong> ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</p>
      <p><strong>Working days:</strong> ${escapeHtml(leave.totalDays)}</p>
      <p><strong>Reason:</strong><br>${safeReason}</p>
      <p><a href="${escapeHtml(hrLeavesUrl)}">Review leave applications</a></p>`,
  });
};

const notifyEmployee = async (leave, notificationType, subject, statusLine, rejectionReason) => {
  const employee = await getEmployee(leave);
  if (!employee?.email) {
    console.info(`Leave ${notificationType} notification skipped: employee email is unavailable.`);
    return;
  }

  const configuration = getSmtpConfiguration(notificationType);
  if (!configuration) return;

  const fromDate = formatDate(leave.fromDate);
  const toDate = formatDate(leave.toDate);
  const employeeName = employee.name || 'Employee';
  const reason = String(rejectionReason ?? '');
  const contentLines = [
    `Hello ${employeeName},`,
    `Leave type: ${leave.type}`,
    `Dates: ${fromDate} to ${toDate}`,
    `Working days: ${leave.totalDays}`,
    statusLine,
    ...(notificationType === 'rejected' ? [`Rejection reason: ${reason}`] : []),
  ];
  const statusHtml = `<p><strong>Status:</strong> ${escapeHtml(statusLine)}</p>`;
  const rejectionHtml = notificationType === 'rejected'
    ? `<p><strong>Rejection reason:</strong><br>${escapeHtml(reason).replace(/\r?\n/g, '<br>')}</p>`
    : '';

  await sendEmail(configuration, notificationType, {
    to: employee.email,
    subject,
    text: contentLines.join('\n'),
    html: `<h2>${escapeHtml(subject)}</h2>
      <p>Hello ${escapeHtml(employeeName)},</p>
      <p><strong>Leave type:</strong> ${escapeHtml(leave.type)}</p>
      <p><strong>Dates:</strong> ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</p>
      <p><strong>Working days:</strong> ${escapeHtml(leave.totalDays)}</p>
      ${statusHtml}${rejectionHtml}`,
  });
};

export const notifyEmployeeLeaveApproved = (leave) =>
  notifyEmployee(leave, 'approved', 'Your leave application was approved', 'Approved');

export const notifyEmployeeLeaveRejected = (leave) =>
  notifyEmployee(
    leave,
    'rejected',
    'Your leave application was rejected',
    'Rejected',
    leave.rejectionReason,
  );
