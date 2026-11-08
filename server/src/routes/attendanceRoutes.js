import { Router } from 'express';
import {
  checkInController,
  checkOutController,
  hrAttendanceController,
  myAttendanceController,
  todayAttendanceController,
} from '../controllers/attendanceController.js';
import authenticate from '../middleware/authenticate.js';
import requireRole from '../middleware/requireRole.js';

const router = Router();

router.use(authenticate);
router.post('/check-in', requireRole('employee'), checkInController);
router.post('/check-out', requireRole('employee'), checkOutController);
router.get('/today', requireRole('employee'), todayAttendanceController);
router.get('/mine', requireRole('employee'), myAttendanceController);
router.get('/', requireRole('hr'), hrAttendanceController);

export default router;
